// Syntax-only parse check for browser ESM modules (no execution).
import vm from 'node:vm';
import fs from 'node:fs';

const files = process.argv.slice(2);
let failed = 0;
for (const f of files) {
  try {
    new vm.SourceTextModule(fs.readFileSync(f, 'utf8'), { identifier: f });
    console.log('OK   ', f);
  } catch (err) {
    failed += 1;
    console.log('FAIL ', f, '→', err.message);
  }
}
process.exit(failed ? 1 : 0);
