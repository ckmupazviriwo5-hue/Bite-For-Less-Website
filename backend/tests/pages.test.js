// Static page routing smoke tests — every bookmarkable URL must serve its page
// directly (Express static + future Vercel static), on an isolated temp DB.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const TEST_PORT = 5004;
const TEST_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfl-pages-')), 'test.db');
process.env.DATABASE_URL = `sqlite:${TEST_DB}`;
const { default: db } = await import('../config/db.js');

let server;
const BASE = `http://localhost:${TEST_PORT}`;

before(async () => {
  server = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: `sqlite:${TEST_DB}` },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await (await fetch(`${BASE}/api/health`)).json()).success, true);
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(path.dirname(TEST_DB), { recursive: true, force: true });
});

const PAGES = [
  '/',
  '/index.html',
  '/deals.html',
  '/deal.html?id=x',
  '/how-it-works.html',
  '/partner.html',
  '/login.html',
  '/signup.html',
  '/dashboards/customer.html',
  '/dashboards/vendor.html',
  '/dashboards/admin.html'
];

for (const page of PAGES) {
  test(`serves ${page} as HTML`, async () => {
    const res = await fetch(`${BASE}${page}`);
    assert.equal(res.status, 200, `${page} -> ${res.status}`);
    assert.match(res.headers.get('content-type') || '', /html/);
    const text = await res.text();
    assert.ok(text.includes('site-header'), `${page} uses shared chrome`);
  });
}

test('shared modules are served', async () => {
  for (const mod of ['js/api.js', 'js/layout.js', 'js/config.js', 'css/styles.css']) {
    const res = await fetch(`${BASE}/${mod}`);
    assert.equal(res.status, 200, `${mod} -> ${res.status}`);
  }
});

test('API still answers alongside static pages', async () => {
  const res = await fetch(`${BASE}/api/deals`);
  assert.equal(res.status, 200);
});
