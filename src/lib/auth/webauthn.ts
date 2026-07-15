// src/lib/auth/webauthn.ts
// WebAuthn (passkey) second factor per §6 rule 2.
//
// WebAuthn is mandatory for owners/global_admins IN ADDITION to TOTP.
// Other roles may optionally register a passkey for passwordless MFA.
//
// Implementation uses @simplewebauthn/server. The credential ID is base64url-
// encoded; the public key is stored in COSE format. Counter is checked on
// every assertion to detect cloned authenticators.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { db } from '../db';

const RP_NAME = 'ERP POS';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getRpId(): string {
  // In production, this is the canonical domain (e.g., erp.example.com).
  // Sandbox uses localhost.
  return process.env.WEBAUTHN_RP_ID ?? 'localhost';
}

function getOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000';
}

/**
 * Generate a registration challenge for a user. Returns the options that
 * the browser passes to navigator.credentials.create().
 */
export async function beginRegistration(params: {
  userId: string;
  companyId: string;
  userEmail: string;
  userName: string;
}): Promise<{ options: RegistrationResponseJSON['response'] | Record<string, unknown> }> {
  // Get existing credentials so the authenticator knows to avoid duplicates
  const existingCreds = await db.webAuthnCredential.findMany({
    where: { userId: params.userId, companyId: params.companyId, revokedAt: null },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userID: new TextEncoder().encode(params.userId),
    userName: params.userEmail,
    userDisplayName: params.userName,
    attestationType: 'none',
    excludeCredentials: existingCreds.map(c => ({
      id: c.credentialId,
      type: 'public-key',
      transports: JSON.parse(c.transports) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store the challenge for later verification
  await db.webAuthnChallenge.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      challenge: options.challenge,
      action: 'registration',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return { options: options as unknown as Record<string, unknown> };
}

/**
 * Verify the registration response from the browser. Stores the credential.
 */
export async function finishRegistration(params: {
  userId: string;
  companyId: string;
  response: RegistrationResponseJSON;
  name?: string;
}): Promise<{ credentialId: string; verified: boolean }> {
  // Find the latest unconsumed registration challenge for this user
  const challenge = await db.webAuthnChallenge.findFirst({
    where: {
      userId: params.userId,
      companyId: params.companyId,
      action: 'registration',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) {
    throw new Error('No active registration challenge — request a new one');
  }

  const verification = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WebAuthn registration verification failed');
  }

  const { credential } = verification.registrationInfo;
  const credentialIdB64 = Buffer.from(credential.id).toString('base64url');

  // Check for duplicate credential ID (shouldn't happen but be safe)
  const existing = await db.webAuthnCredential.findUnique({
    where: { credentialId: credentialIdB64 },
  });
  if (existing) {
    throw new Error('Credential already registered');
  }

  await db.webAuthnCredential.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      credentialId: credentialIdB64,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: (credential as any).deviceType ?? null,
      backedUp: (credential as any).backedUp ?? false,
      transports: JSON.stringify(credential.transports ?? []),
      name: params.name ?? null,
    },
  });

  // Mark challenge as consumed
  await db.webAuthnChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { credentialId: credentialIdB64, verified: true };
}

/**
 * Generate an authentication challenge for a user. Returns options that the
 * browser passes to navigator.credentials.get().
 */
export async function beginAuthentication(params: {
  companyId: string;
  userId: string;
}): Promise<{ options: Record<string, unknown> }> {
  const creds = await db.webAuthnCredential.findMany({
    where: { userId: params.userId, companyId: params.companyId, revokedAt: null },
    select: { credentialId: true, transports: true },
  });
  if (creds.length === 0) {
    throw new Error('No registered WebAuthn credentials for this user');
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    allowCredentials: creds.map(c => ({
      id: c.credentialId,
      type: 'public-key',
      transports: JSON.parse(c.transports) as AuthenticatorTransport[],
    })),
    userVerification: 'preferred',
  });

  await db.webAuthnChallenge.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      challenge: options.challenge,
      action: 'assertion',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return { options: options as unknown as Record<string, unknown> };
}

/**
 * Verify the authentication response. Returns true if the credential is valid
 * and the counter has advanced (cloning detection).
 */
export async function finishAuthentication(params: {
  companyId: string;
  userId: string;
  response: AuthenticationResponseJSON;
}): Promise<{ verified: boolean; credentialId: string }> {
  const challenge = await db.webAuthnChallenge.findFirst({
    where: {
      userId: params.userId,
      companyId: params.companyId,
      action: 'assertion',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) {
    throw new Error('No active authentication challenge — request a new one');
  }

  // Find the credential by ID
  const credentialIdB64 = params.response.id;
  const credential = await db.webAuthnCredential.findFirst({
    where: { credentialId: credentialIdB64, userId: params.userId, revokedAt: null },
  });
  if (!credential) {
    throw new Error('Credential not found or revoked');
  }

  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: JSON.parse(credential.transports) as AuthenticatorTransport[],
    },
  });

  if (!verification.verified) {
    throw new Error('WebAuthn authentication verification failed');
  }

  // Counter must advance — if not, the authenticator may have been cloned
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter <= credential.counter) {
    // Possible cloned authenticator — revoke the credential + security event
    await db.webAuthnCredential.update({
      where: { id: credential.id },
      data: { revokedAt: new Date() },
    });
    await db.securityEvent.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        eventType: 'webauthn_counter_regression',
        severity: 'critical',
        metadata: JSON.stringify({
          credential_id: credentialIdB64,
          old_counter: credential.counter,
          new_counter: newCounter,
        }),
      },
    });
    throw new Error('WebAuthn counter regression — credential revoked (possible clone)');
  }

  // Update counter + lastUsedAt
  await db.webAuthnCredential.update({
    where: { id: credential.id },
    data: { counter: newCounter, lastUsedAt: new Date() },
  });

  await db.webAuthnChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { verified: true, credentialId: credentialIdB64 };
}

/**
 * List a user's registered WebAuthn credentials.
 */
export async function listCredentials(params: {
  companyId: string;
  userId: string;
}) {
  const creds = await db.webAuthnCredential.findMany({
    where: { companyId: params.companyId, userId: params.userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return creds.map(c => ({
    id: c.id,
    name: c.name,
    credentialId: c.credentialId.slice(0, 16) + '...', // truncated for display
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  }));
}

/**
 * Revoke a WebAuthn credential (soft delete).
 */
export async function revokeCredential(params: {
  companyId: string;
  userId: string;
  credentialId: string; // internal DB id, not the WebAuthn credential ID
}): Promise<void> {
  await db.webAuthnCredential.updateMany({
    where: {
      id: params.credentialId,
      companyId: params.companyId,
      userId: params.userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
