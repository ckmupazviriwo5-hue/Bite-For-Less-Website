// Boots the server once against a THROWAWAY temp DB to expose boot-time errors.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_PORT = 5031;
const TEST_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfl-boot-')), 'test.db');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
console.log('ROOT =', ROOT);
const child = spawn(process.execPath, ['backend/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: `sqlite:${TEST_DB}` },
  stdio: ['ignore', 'pipe', 'pipe']
});
dotenv: child.stdout.on('data', (d) => console.log('OUT>', d.toString().trim()));
let errAll = '';
child.stderr.on('data', (d) => { errAll += d.toString(); });
child.on('exit', (code, sig) => {
  console.log('CHILD EXIT code=', code, 'signal=', sig);
  console.log('STDERR>>>', errAll.slice(0, 4000) || '(none)');
  process.exit(0);
});
setTimeout(() => {
  console.log('--- after 8s: child alive =', child.exitCode === null);
  fetch(`http://localhost:${TEST_PORT}/api/health`)
    .then((r) => r.text())
    .then((t) => console.log('HEALTH:', t))
    .catch((e) => console.log('HEALTH FETCH FAIL:', e.message));
  setTimeout(() => { child.kill(); }, 2500);
}, 8000);
