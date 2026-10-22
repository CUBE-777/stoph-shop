// Downloads every file of the "product-images" bucket into backups/<timestamp>/storage and writes a SHA-256 manifest.
// Run ON YOUR OWN COMPUTER ONLY. It needs the service_role key, which bypasses all security:
//   PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/backup-storage.mjs
// Never commit the key, never paste it in Netlify, never put it in .env files inside this repository (backups/ is git-ignored).
// STATUS: written but not run against a real project in the build environment (no network there).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
const BUCKET = process.env.BUCKET || 'product-images';
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this terminal session only.'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function list(prefix) {            // one level; folders come back without an "id"
  const out = []; let offset = 0;
  for (;;) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers,
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }) });
    if (!res.ok) throw new Error(`list failed (${res.status}) for "${prefix}"`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 100) return out;
    offset += 100;
  }
}
async function walk(prefix = '') {
  const files = [];
  for (const item of await list(prefix)) {
    const p = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) files.push(p); else files.push(...await walk(p));
  }
  return files;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join('backups', stamp, 'storage');
const files = await walk();
const manifest = [];
for (const f of files) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${f.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) { console.error(`FAILED ${f} (${res.status})`); manifest.push({ path: f, error: res.status }); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const target = join(dir, f);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buf);
  manifest.push({ path: f, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
}
writeFileSync(join('backups', stamp, 'storage-manifest.json'), JSON.stringify({ bucket: BUCKET, created: stamp, files: manifest }, null, 2));
const failed = manifest.filter((m) => m.error).length;
console.log(`${manifest.length - failed}/${manifest.length} files saved in backups/${stamp}`);
process.exit(failed ? 2 : 0);
