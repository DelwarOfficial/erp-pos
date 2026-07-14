// scripts/backup/upload-wal.ts
// Uploads a single WAL segment to S3/MinIO.
// Called by wal-archive.sh when aws CLI is not available.

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.S3_REGION ?? 'ap-south-1';
const bucket = process.env.S3_BUCKET ?? 'erp-pos-backups';
const key = process.env.S3_KEY!;
const walPath = process.env.WAL_PATH!;

if (!key || !walPath) {
  console.error('S3_KEY and WAL_PATH env vars required');
  process.exit(1);
}

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

async function main() {
  const body = readFileSync(walPath);

  // Check if already uploaded (idempotent — Postgres may retry)
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.error(`WAL ${key} already archived — skipping`);
    process.exit(0); // already exists = success for archive_command
  } catch {
    // Not found — proceed to upload
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/octet-stream',
  }));
}

main().catch((e) => {
  console.error('WAL upload failed:', e);
  process.exit(1);
});
