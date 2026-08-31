import fs from 'node:fs';
import https from 'node:https';
import process from 'node:process';

const source = fs.readFileSync(new URL('./ssh-test.mjs', import.meta.url), 'utf8');
const username = source.match(/username:\s*['\"]([^'\"]+)['\"]/)?.[1];
const password = source.match(/password:\s*['\"]([^'\"]+)['\"]/)?.[1];
const endpoint = process.argv[2];

if (!username || !password || !endpoint || !/^[A-Za-z]+\/[A-Za-z_]+$/.test(endpoint)) {
  throw new Error('Usage: node scripts/cpanel-safe-api.mjs Module/function');
}

function redact(value, key = '') {
  if (/password|passwd|secret|token|credential|database.?url/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === 'string') {
    return value.replace(/(mysql|mariadb|postgres(?:ql)?):\/\/[^\s@]+@/gi, '$1://[REDACTED]@');
  }
  return value;
}

const request = https.get(
  `https://host.zhostbd.com:2083/execute/${endpoint}`,
  {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      Accept: 'application/json',
    },
    timeout: 15_000,
  },
  (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      if (response.statusCode !== 200) throw new Error(`cPanel HTTP ${response.statusCode}`);
      console.log(JSON.stringify(redact(JSON.parse(body)), null, 2));
    });
  },
);

request.on('timeout', () => request.destroy(new Error('cPanel request timed out')));
request.on('error', (error) => {
  console.error(`cPanel API error: ${error.message}`);
  process.exitCode = 1;
});
