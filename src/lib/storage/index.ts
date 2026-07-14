// src/lib/storage/index.ts
// S3-compatible object storage adapter per §1 (encrypted at rest, versioned, signed URLs).
// Uses MinIO in development, AWS S3 / GCS / Cloudflare R2 in production.

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageAdapter {
  putObject(params: { key: string; body: Buffer; contentType: string; metadata?: Record<string, string> }): Promise<{ etag: string; versionId?: string }>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string; metadata?: Record<string, string> }>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  headObject(key: string): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }>;
}

// ── S3 Adapter (works with AWS S3, MinIO, R2, GCS) ──
export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:9000');
    this.bucket = process.env.S3_BUCKET ?? 'erp-pos-storage';
    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'ap-south-1',
      endpoint,
      forcePathStyle: endpoint?.includes('localhost') || endpoint?.includes('minio'),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
      },
    });
  }

  async putObject(params: { key: string; body: Buffer; contentType: string; metadata?: Record<string, string> }): Promise<{ etag: string; versionId?: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
      // SSE-KMS in production, SSE-S3 in sandbox (encryption at rest is mandatory per §13)
      ServerSideEncryption: process.env.NODE_ENV === 'production' ? 'aws:kms' : 'AES256',
      BucketKeyEnabled: process.env.NODE_ENV === 'production',
    });
    const result = await this.client.send(command);
    return {
      etag: (result.ETag ?? '').replace(/"/g, ''),
      versionId: result.VersionId,
    };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string; metadata?: Record<string, string> }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const result = await this.client.send(command);
    if (!result.Body) throw new Error('S3 getObject: empty body');
    const body = Buffer.from(await result.Body.transformToByteArray());
    return {
      body,
      contentType: result.ContentType ?? 'application/octet-stream',
      metadata: result.Metadata,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return awsGetSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async headObject(key: string): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        exists: true,
        size: result.ContentLength,
        contentType: result.ContentType,
        etag: (result.ETag ?? '').replace(/"/g, ''),
      };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotFound') return { exists: false };
      if (e instanceof Error && 'name' in e && (e as { name: string }).name === 'NotFound') return { exists: false };
      throw e;
    }
  }
}

// ── In-memory adapter for tests ──
export class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, { body: Buffer; contentType: string; metadata?: Record<string, string> }>();

  async putObject(params: { key: string; body: Buffer; contentType: string; metadata?: Record<string, string> }) {
    this.store.set(params.key, { body: params.body, contentType: params.contentType, metadata: params.metadata });
    return { etag: `mem-${params.key.length}` };
  }
  async getObject(key: string) {
    const item = this.store.get(key);
    if (!item) throw new Error('Not found');
    return item;
  }
  async deleteObject(key: string) { this.store.delete(key); }
  async getSignedUrl(key: string, _expiresIn: number) { return `memory://${key}`; }
  async headObject(key: string) {
    const item = this.store.get(key);
    if (!item) return { exists: false };
    return { exists: true, size: item.body.length, contentType: item.contentType };
  }
}

// Singleton
let storageAdapter: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (!storageAdapter) {
    if (process.env.NODE_ENV === 'test') {
      storageAdapter = new MemoryStorageAdapter();
    } else {
      storageAdapter = new S3StorageAdapter();
    }
  }
  return storageAdapter;
}

export function setStorageForTest(adapter: StorageAdapter): void {
  storageAdapter = adapter;
}
