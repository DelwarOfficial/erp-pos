import { Client } from 'ssh2';
const conn = new Client();
conn.on('ready', () => {
  console.log('SSH ready');
  conn.exec('pwd; ls -la; node -v; pwd; echo ---; cat .env 2>&1 | head -20; echo ---; ls ~/erp-pos 2>&1 | head -20', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => { conn.end(); }).on('data', d=>process.stdout.write(d)).stderr.on('data', d=>process.stderr.write(d));
  });
}).on('error', e=>{console.error('SSH err',e.message); process.exit(1)}).connect({
  host: '151.158.44.84',
  port: 22,
  username: 'rangpurt',
  password: 'C201y7Tzls',
  readyTimeout: 15000,
  keepaliveInterval: 5000
});
