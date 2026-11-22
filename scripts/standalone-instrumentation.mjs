// scripts/standalone-instrumentation.mjs
// (Not under scripts/build/: .gitignore ignores every build/ directory.)
//
// `next build` with output: 'standalone' (Next 16.3) leaves
// .next/server/instrumentation.js and the modules it imports out of
// .next/standalone. The standalone server then never calls register(), so in
// production the security guard (assertProductionSecurityConfig), Sentry and
// OpenTelemetry silently never start: a server with a weak JWT_SECRET started
// and served requests.
//
// This copies instrumentation.js and every file in its trace
// (instrumentation.js.nft.json, produced by the same build) into the
// standalone tree, at the same relative paths. Run after `next build`.
// Fails the build if the files are missing, so the gap cannot come back silently.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const server = join(root, '.next', 'server');
const standalone = join(root, '.next', 'standalone');
const entry = join(server, 'instrumentation.js');
const trace = join(server, 'instrumentation.js.nft.json');

if (!existsSync(standalone)) { console.error('standalone-instrumentation: .next/standalone is missing (output: "standalone"?)'); process.exit(1); }
if (!existsSync(entry) || !existsSync(trace)) { console.error('standalone-instrumentation: .next/server/instrumentation.js or its trace is missing'); process.exit(1); }

const files = [entry, ...JSON.parse(readFileSync(trace, 'utf8')).files.map(f => resolve(server, f))];
let copied = 0;
for (const from of files) {
  const rel = relative(root, from);
  if (rel.startsWith('..')) continue; // never copy from outside the project
  if (!existsSync(from) || !statSync(from).isFile()) continue;
  const to = join(standalone, rel);
  if (existsSync(to)) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
if (!existsSync(join(standalone, '.next', 'server', 'instrumentation.js'))) { console.error('standalone-instrumentation: copy failed'); process.exit(1); }
console.log(`standalone-instrumentation: instrumentation.js and ${copied} traced file(s) added to .next/standalone`);
