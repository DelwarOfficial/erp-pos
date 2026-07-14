// src/lib/auth/password.ts
// Argon2id password hashing per §6 rule 4 (memory≥64MB, time≥3).

import argon2 from 'argon2';

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export const PROGRESSIVE_LOCKOUT_STEPS = [
  { afterFailures: 5, lockMinutes: 5 },
  { afterFailures: 10, lockMinutes: 30 },
  { afterFailures: 15, lockMinutes: 240 },
  { afterFailures: 20, lockMinutes: 1440 },
];

export function getLockoutDuration(failedCount: number): { lockUntil: Date | null; lockMinutes: number | null } {
  let best: { lockMinutes: number } | null = null;
  for (const step of PROGRESSIVE_LOCKOUT_STEPS) {
    if (failedCount >= step.afterFailures) {
      best = step;
    }
  }
  if (!best) return { lockUntil: null, lockMinutes: null };
  const lockUntil = new Date(Date.now() + best.lockMinutes * 60_000);
  return { lockUntil, lockMinutes: best.lockMinutes };
}
