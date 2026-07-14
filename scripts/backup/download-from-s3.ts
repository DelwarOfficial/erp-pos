// scripts/backup/download-from-s3.ts
// Downloads backup file + checksum + metadata from S3/MinIO.
// Used by restore-from-backup.sh when aws CLI is not available.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync } from 'node:fs';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.S3_REGION ?? 'ap-south-1';
const bucket = process.env.S3_BUCKET ?? 'erp-pos-backups';

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

async function download(s3Key: string, localPath: string): Promise<void> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  if (!res.Body) throw new Error(`Empty body for ${s3Key}`);
  const buf = Buffer.from(await res.Body.transformToByteArray());
  writeFileSync(localPath, buf);
  console.log(`  ✓ Downloaded ${s3Key} → ${localPath} (${buf.length} bytes)`);
}

async function main() {
  // Args: s3Key localPath [s3Key2 localPath2 ...]
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length % 2 !== 0) {
    console.error('Usage: download-from-s3.ts <s3Key> <localPath> [<s3Key> <localPath> ...]');
    process.exit(1);
  }
  for (let i = 0; i < args.length; i += 2) {
    await download(args[i], args[i + 1]);
  }
}

main().catch((e) => {
  console.error('Download failed:', e);
  process.exit(1);
});
