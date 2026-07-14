// scripts/backup/upload-to-s3.ts
// Uploads backup file + checksum + metadata to S3/MinIO using @aws-sdk/client-s3.
// Used by nightly-backup.sh when aws CLI is not available.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.S3_REGION ?? 'ap-south-1';
const bucket = process.env.S3_BUCKET ?? 'erp-pos-backups';
const key = process.env.S3_KEY!;
const backupFile = process.env.BACKUP_FILE!;
const checksumFile = process.env.CHECKSUM_FILE!;
const metaFile = process.env.META_FILE!;

if (!key || !backupFile) {
  console.error('S3_KEY and BACKUP_FILE env vars required');
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

async function upload(filePath: string, s3Key: string, contentType: string): Promise<void> {
  const body = readFileSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    Body: body,
    ContentType: contentType,
  }));
  console.log(`  ✓ Uploaded ${s3Key} (${body.length} bytes)`);
}

async function main() {
  console.log(`Uploading to s3://${bucket}/${key}`);
  await upload(backupFile, key, 'application/octet-stream');
  await upload(checksumFile, `${key}.sha256`, 'text/plain');
  await upload(metaFile, `${key}.meta.json`, 'application/json');
  console.log('All uploads complete');
}

main().catch((e) => {
  console.error('Upload failed:', e);
  process.exit(1);
});
