import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'prisma', 'schema.prisma');
const targetPath = path.join(root, 'prisma', 'mariadb', 'schema.prisma');

let schema = fs.readFileSync(sourcePath, 'utf8');
schema = schema.replace(/\n\s*preview\s*=\s*\[[^\n]*\]/, '');
schema = schema.replace(
  /generator client \{\s*provider = "prisma-client-js"/,
  'generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]',
);
schema = schema.replace(
  /datasource db \{\s*provider = "sqlite"\s*url\s*=\s*env\("DATABASE_URL"\)\s*\}/,
  'datasource db {\n  provider          = "mysql"\n  url               = env("DATABASE_URL")\n  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")\n}',
);

fs.writeFileSync(targetPath, schema);
console.log(targetPath);
