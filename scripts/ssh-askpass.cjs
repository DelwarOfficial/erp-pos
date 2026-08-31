const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'ssh-test.mjs'), 'utf8');
const password = source.match(/password:\s*['\"]([^'\"]+)['\"]/)?.[1];
if (!password) process.exit(1);
process.stdout.write(password);
