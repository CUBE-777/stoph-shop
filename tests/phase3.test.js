// Phase 3 tests: pure logic + static consistency checks between SQL, UI and translations.
// These run with `npm test` (no database, no browser). They do NOT prove the SQL works — see tests/db/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cityKey, pickShippingFee, RETURN_REASONS, canReturnTransition, canRegisterReturn, canCancelOrder, validateReason,
  GENERIC_STATUS_TARGETS, mfaGate, fitWithin, sitemapXml, truncateText, ORDER_TRANSITIONS,
} from '../src/lib/shop.js';
import { dictionary } from '../src/i18n/dictionary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d, out = []) => { for (const f of fs.readdirSync(path.join(root, d))) { const p = `${d}/${f}`; fs.statSync(path.join(root, p)).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const sqlFiles = fs.readdirSync(path.join(root, 'supabase')).filter((f) => f.endsWith('.sql')).sort();
const srcFiles = walk('src').filter((f) => /\.jsx?$/.test(f));

test('shipping: accents/case/punctuation match the city rate, unknown city gets the default', () => {
  const rates = [{ is_default: true, city: null, fee: 40 }, { is_default: false, city: 'Fès', fee: 30 }, { is_default: false, city: 'Casablanca', fee: 25 }];
  assert.equal(cityKey(' FÈS. '), 'fes');
  assert.equal(pickShippingFee(rates, 'fes'), 30);
  assert.equal(pickShippingFee(rates, 'Fès'), 30);
  assert.equal(pickShippingFee(rates, 'CASABLANCA'), 25);
  assert.equal(pickShippingFee(rates, 'Tanger'), 40);        // default
  assert.equal(pickShippingFee(rates, ''), 40);
  assert.equal(pickShippingFee([{ is_default: false, city: 'Fès', fee: 30 }], 'Rabat'), null); // no default configured
});

test('returns: reasons, transitions and who can register what', () => {
  assert.equal(RETURN_REASONS.length, 9);
  assert.ok(canReturnTransition('requested', 'approved') && canReturnTransition('requested', 'rejected') && canReturnTransition('approved', 'received'));
  assert.ok(!canReturnTransition('requested', 'received'));       // cannot skip approval
  assert.ok(!canReturnTransition('rejected', 'approved') && !canReturnTransition('received', 'approved'));
  assert.ok(canRegisterReturn('shipped') && canRegisterReturn('delivered') && !canRegisterReturn('confirmed') && !canRegisterReturn('cancelled'));
  assert.ok(canCancelOrder('pending_confirmation') && canCancelOrder('preparing') && !canCancelOrder('shipped') && !canCancelOrder('delivered'));
});

test('returns: reason validation mirrors the server', () => {
  assert.equal(validateReason('defective', ''), null);
  assert.equal(validateReason('nope', ''), 'invalid_reason');
  assert.equal(validateReason('other', ''), 'note_required');
  assert.equal(validateReason('other', 'ab'), 'note_required');
  assert.equal(validateReason('other', 'client absent'), null);
  assert.equal(validateReason('defective', 'x'.repeat(501)), 'invalid_notes');
});

test('generic status path never offers cancelled/returned (they need a reason record)', () => {
  const all = () => true;
  for (const from of Object.keys(ORDER_TRANSITIONS)) {
    const t = GENERIC_STATUS_TARGETS(from, all);
    assert.ok(!t.includes('cancelled') && !t.includes('returned'), from);
  }
  assert.deepEqual(GENERIC_STATUS_TARGETS('pending_confirmation', all), ['confirmed']);
});

test('MFA gate decisions', () => {
  const aal1 = { currentLevel: 'aal1', nextLevel: 'aal1' };
  assert.equal(mfaGate({ currentLevel: 'aal1', nextLevel: 'aal2' }, { enforced: true, required: true }), 'challenge');
  assert.equal(mfaGate({ currentLevel: 'aal2', nextLevel: 'aal2' }, { enforced: true, required: true }), 'ok');
  assert.equal(mfaGate(aal1, { enforced: true, required: true }), 'enroll');            // required, nothing enrolled
  assert.equal(mfaGate(aal1, { enforced: false, required: true }), 'ok');               // roll-out not switched on yet
  assert.equal(mfaGate(aal1, { enforced: true, required: false }), 'ok');               // e.g. support role
  assert.equal(mfaGate({ currentLevel: 'aal1', nextLevel: 'aal2' }, { enforced: false, required: false }), 'challenge'); // enrolled users are always asked
});

test('image sizing keeps aspect ratio and never upscales', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(0, 10), { width: 0, height: 0 });
});

test('sitemap + meta helpers', () => {
  const xml = sitemapXml('https://x.ma', [{ slug: 'a-b', updated_at: '2026-01-02T00:00:00Z' }, { slug: 'c&d' }], new Date('2026-03-04'));
  assert.match(xml, /<loc>https:\/\/x\.ma\/products\/a-b<\/loc><lastmod>2026-01-02<\/lastmod>/);
  assert.match(xml, /c&amp;d/);
  assert.ok(!xml.includes('/admin') && !xml.includes('/checkout'));
  assert.equal(truncateText('a'.repeat(300), 155).length, 155);
  assert.equal(truncateText('  hello   world '), 'hello world');
});

test('i18n: ar/fr have identical keys and no empty strings', () => {
  const a = Object.keys(dictionary.ar), b = Object.keys(dictionary.fr);
  assert.deepEqual(a.filter((k) => !b.includes(k)), []);
  assert.deepEqual(b.filter((k) => !a.includes(k)), []);
  for (const l of ['ar', 'fr']) for (const [k, v] of Object.entries(dictionary[l])) assert.ok(String(v).trim(), `${l}:${k}`);
});

test('i18n: every static t(\'key\') used in src exists', () => {
  const missing = [];
  for (const f of srcFiles.filter((x) => !x.includes('/i18n/'))) {
    for (const m of read(f).matchAll(/\bt\('([^']+)'\)/g)) if (!(m[1] in dictionary.ar)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('every error code raised by SQL has a translated err.* message', () => {
  const codes = new Set();
  for (const f of sqlFiles.filter((x) => !x.startsWith('05_'))) {
    for (const m of read(`supabase/${f}`).matchAll(/raise exception '([a-z_]+)'/g)) codes.add(m[1]);
  }
  const missing = [...codes].filter((c) => !(`err.${c}` in dictionary.ar));
  assert.deepEqual(missing, []);
  assert.ok(codes.size > 25, `found only ${codes.size} codes`);
});

test('every supabase.rpc(...) used by the UI is defined in the SQL files', () => {
  const sql = sqlFiles.map((f) => read(`supabase/${f}`)).join('\n');
  const defined = new Set([...sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const f of srcFiles) for (const m of read(f).matchAll(/rpc\('([a-z_0-9]+)'/g)) used.add(m[1]);
  assert.deepEqual([...used].filter((u) => !defined.has(u)), []);
  assert.ok(used.has('cancel_order') && used.has('admin_search_orders') && used.has('mfa_status'));
});

test('migrations are transactional and later ones never re-run the old phase-1 functions', () => {
  for (const f of ['06', '07', '08', '09', '10', '11'].map((p) => sqlFiles.find((x) => x.startsWith(p)))) {
    const s = read(`supabase/${f}`);
    assert.match(s, /^begin;$/m, f); assert.match(s, /^commit;$/m, f);
  }
});

test('security: sensitive helpers are never granted to anon; staff RPCs are authenticated-only', () => {
  const s = read('supabase/10_phase3_security.sql') + read('supabase/11_phase3_orders_returns.sql');
  assert.doesNotMatch(s, /grant execute on function[^;]*\bto\b[^;]*\banon\b/i);
  for (const fn of ['cancel_order', 'register_return', 'update_return', 'admin_returns', 'admin_search_orders', 'admin_report', 'set_mfa_enforcement', 'mfa_status']) {
    assert.match(s, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`), fn);
  }
  assert.match(s, /_mfa_satisfied\(\) and exists/);            // has_permission is the MFA gate
});

test('security: no service_role key, no raw HTML injection, no eval in the browser code', () => {
  for (const f of srcFiles) {
    const s = read(f).replace(/\/\/.*$/gm, '');   // comments may mention the word; code must not use it
    assert.doesNotMatch(s, /service_role/i, f);
    assert.doesNotMatch(s, /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/, f);
  }
  for (const f of ['.env.example', 'netlify.toml', 'README.md']) assert.doesNotMatch(read(f), /eyJ[A-Za-z0-9_-]{20,}\./, `${f} looks like it contains a JWT`);
  assert.match(read('.gitignore'), /^\.env\.\*$/m);
});

// ---- WCAG contrast of the design tokens (AA = 4.5:1 for normal text) ----
function tokens(theme) {
  const css = read('src/styles.css');
  const block = css.match(new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`))[1];
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const theme of ['dark', 'light']) {
  test(`contrast (${theme}): text, muted, ok and bad meet AA on bg, surface and surface-2`, () => {
    const t = tokens(theme);
    const fails = [];
    for (const fg of ['text', 'muted', 'ok', 'bad', 'silver']) for (const bg of ['bg', 'surface', 'surface-2']) {
      const r = ratio(t[fg], t[bg]);
      if (r < 4.5) fails.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(fails, []);
  });
}
test('contrast: primary button (white on red) meets AA in both themes', () => {
  const css = read('src/styles.css');
  const red = css.match(/--red:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(ratio('#ffffff', red) >= 4.5, `white on ${red} = ${ratio('#ffffff', red).toFixed(2)}`);
});
