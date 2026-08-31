import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'ssh2';

const source = fs.readFileSync(new URL('./ssh-test.mjs', import.meta.url), 'utf8');

function setting(name) {
  const match = source.match(new RegExp(`${name}:\\s*['\"]([^'\"]+)['\"]`));
  if (!match) throw new Error(`Missing SSH ${name} in scripts/ssh-test.mjs`);
  return match[1];
}

const command = process.argv.slice(2).join(' ');
if (!command) throw new Error('Usage: node scripts/remote-safe-exec.mjs <command>');

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(command, (error, stream) => {
      if (error) throw error;
      stream
        .on('close', (code) => {
          conn.end();
          process.exitCode = code ?? 1;
        })
        .on('data', (data) => process.stdout.write(data));
      stream.stderr.on('data', (data) => process.stderr.write(data));
    });
  })
  .on('error', (error) => {
    console.error(`SSH error: ${error.message}`);
    process.exitCode = 1;
  })
  .connect({
    host: setting('host'),
    port: Number(source.match(/port:\s*(\d+)/)?.[1] ?? 22),
    username: setting('username'),
    password: setting('password'),
    readyTimeout: 15_000,
    keepaliveInterval: 5_000,
  });
