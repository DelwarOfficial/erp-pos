// Keep maintained documentation under docs/, preserving tool-owned locations.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean))];
const entryPoints = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'public/robots.txt']);
const packageLocations = ['.agents/skills/', '.codex/skills/', 'graphify-out/'];
const misplaced = files.filter(path => /\.(md|mdx|rst|adoc|txt|pdf|doc|docx)$/i.test(path)
  && existsSync(resolve(root, path))
  && !path.startsWith('docs/') && !entryPoints.has(path)
  && !packageLocations.some(prefix => path.startsWith(prefix)));

if (misplaced.length) {
  console.error('Move maintained documentation into docs/ and update its references:\n' + misplaced.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Documentation locations OK: maintained docs are under docs/; tool-owned exceptions remain in place.');
}
