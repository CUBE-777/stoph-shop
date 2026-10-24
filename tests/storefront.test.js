// Storefront upgrade tests: money precision, carousel/banner rules, favourites, duplicate-order token, migration 12 checks.
// `npm test` runs them with no database or browser. Browser behaviour was checked separately (docs/09-STOREFRONT-UPGRADE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cartSubtotal, lineTotal, toMinor, sanitizeCart, MAX_QTY, clampInterval, carouselSettings, bannerEligible, sortBanners, slideIndex,
  swipeDirection, resolveBannerLink, isSafeInternalPath, isSafeHttpsUrl, bannerText, bannerStatus, toLocalInput, fromLocalInput,
  validateBanner, validateImageFile, toggleFavorite, sanitizeFavorites, checkoutSignature, getCheckoutToken, clearCheckoutToken,
} from '../src/lib/shop.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('money: sums use integer minor units (no float drift)', () => {
  assert.equal(0.1 + 0.2 === 0.3, false);                                  // the problem
  assert.equal(cartSubtotal([{ price: 0.1, qty: 1 }, { price: 0.2, qty: 1 }]), 0.3);
  assert.equal(cartSubtotal([{ price: 19.99, qty: 3 }]), 59.97);
  assert.equal(lineTotal(33.33, 3), 99.99);
  assert.equal(toMinor('12.345'), 1235 - 1 + 1 === 1235 ? 1235 : toMinor('12.345'));
  assert.equal(cartSubtotal([]), 0);
});

test('cart restore: malformed or tampered storage is cleaned, quantities clamped', () => {
  assert.deepEqual(sanitizeCart('nope'), []);
  const c = sanitizeCart([{ productId: 'a', price: '10', qty: 999 }, { productId: 'b', price: 'abc', qty: 1 }, null, 5, { price: 1, qty: 1 }, { productId: 'c', price: -3, qty: 1 }, { productId: 'd', price: 5, qty: 0 }]);
  assert.deepEqual(c.map((x) => [x.productId, x.price, x.qty]), [['a', 10, MAX_QTY], ['d', 5, 1]]);
});

test('carousel settings: interval clamped 3..15, transition whitelisted, autoplay default on', () => {
  assert.equal(clampInterval(1), 3); assert.equal(clampInterval(99), 15); assert.equal(clampInterval('abc'), 5); assert.equal(clampInterval(6.4), 6);
  assert.deepEqual(carouselSettings(null), { autoplay: true, interval_seconds: 5, transition: 'slide' });
  assert.deepEqual(carouselSettings({ autoplay: false, interval_seconds: 8, transition: 'zoom' }), { autoplay: false, interval_seconds: 8, transition: 'slide' });
  assert.equal(carouselSettings({ transition: 'fade' }).transition, 'fade');
});

test('banner eligibility = enabled AND inside schedule (same rule as the RLS policy)', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const b = (o) => ({ is_active: true, starts_at: null, ends_at: null, ...o });
  assert.ok(bannerEligible(b({}), now));
  assert.ok(!bannerEligible(b({ is_active: false }), now));
  assert.ok(!bannerEligible(b({ starts_at: '2026-06-16T00:00:00Z' }), now));      // not started
  assert.ok(!bannerEligible(b({ ends_at: '2026-06-15T12:00:00Z' }), now));        // end is exclusive
  assert.ok(bannerEligible(b({ starts_at: '2026-06-15T12:00:00Z', ends_at: '2026-06-15T12:00:01Z' }), now));
  assert.ok(!bannerEligible(null, now));
  assert.deepEqual(sortBanners([{ id: 2, sort_order: 20 }, { id: 3, sort_order: 10, created_at: 'b' }, { id: 1, sort_order: 10, created_at: 'a' }]).map((x) => x.id), [1, 3, 2]);
});

test('slide navigation wraps; swipe direction follows reading direction and ignores vertical scrolls', () => {
  assert.equal(slideIndex(0, 3, -1), 2); assert.equal(slideIndex(2, 3, 1), 0); assert.equal(slideIndex(0, 0, 1), 0);
  assert.equal(swipeDirection(-80, 5, false), 1); assert.equal(swipeDirection(80, 5, false), -1);   // LTR: drag left = next
  assert.equal(swipeDirection(80, 5, true), 1); assert.equal(swipeDirection(-80, 5, true), -1);     // RTL: drag right = next
  assert.equal(swipeDirection(20, 0), 0); assert.equal(swipeDirection(90, 120), 0);
});

test('banner destinations: only products/categories/known pages/internal paths/https — never javascript:, data:, //host', () => {
  assert.deepEqual(resolveBannerLink({ link_type: 'product', products: { slug: 'abc' } }), { to: '/products/abc' });
  assert.equal(resolveBannerLink({ link_type: 'product', products: null }), null);                    // deleted / unpublished product
  assert.deepEqual(resolveBannerLink({ link_type: 'category', categories: { slug: 'a b' } }), { to: '/products?category=a%20b' });
  assert.deepEqual(resolveBannerLink({ link_type: 'page', page_path: '/delivery' }), { to: '/delivery' });
  assert.equal(resolveBannerLink({ link_type: 'page', page_path: '/admin' }), null);
  assert.deepEqual(resolveBannerLink({ link_type: 'url', link_url: '/products?sort=new' }), { to: '/products?sort=new' });
  assert.deepEqual(resolveBannerLink({ link_type: 'url', link_url: 'https://example.com/x' }), { href: 'https://example.com/x' });
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//evil.com', 'http://plain.com', 'ftp://x', ' /x', '/x y', '', null]) {
    assert.equal(resolveBannerLink({ link_type: 'url', link_url: bad }), null, String(bad));
  }
  assert.equal(resolveBannerLink({ link_type: 'none' }), null);
  assert.ok(isSafeInternalPath('/') && !isSafeInternalPath('//') && isSafeHttpsUrl('https://a.b') && !isSafeHttpsUrl('javascript:1'));
});

test('banner text falls back to the other language', () => {
  assert.equal(bannerText({ title_ar: 'أ', title_fr: 'F' }, 'title', 'fr'), 'F');
  assert.equal(bannerText({ title_ar: 'أ', title_fr: '' }, 'title', 'fr'), 'أ');
  assert.equal(bannerText({}, 'title', 'ar'), '');
});

test('banner status labels and datetime-local round trip', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(bannerStatus({ is_active: false }, now), 'disabled');
  assert.equal(bannerStatus({ is_active: true, starts_at: '2027-01-01T00:00:00Z' }, now), 'scheduled');
  assert.equal(bannerStatus({ is_active: true, ends_at: '2020-01-01T00:00:00Z' }, now), 'expired');
  assert.equal(bannerStatus({ is_active: true }, now), 'live');
  const iso = '2026-10-05T08:30:00.000Z';
  assert.equal(fromLocalInput(toLocalInput(iso)), iso);
  assert.equal(toLocalInput(null), ''); assert.equal(fromLocalInput(''), null); assert.equal(fromLocalInput('garbage'), null);
});

test('banner form validation', () => {
  const ok = { title_ar: 'أ', title_fr: 'F', link_type: 'none', is_active: false };
  assert.deepEqual(validateBanner(ok, { hasImage: false }), {});
  assert.ok(validateBanner({ ...ok, title_ar: ' ' }, { hasImage: true }).title_ar);
  assert.ok(validateBanner({ ...ok, is_active: true }, { hasImage: false }).image);               // cannot publish without an image
  assert.deepEqual(validateBanner({ ...ok, is_active: true }, { hasImage: true }), {});
  assert.ok(validateBanner({ ...ok, link_type: 'product' }, { hasImage: true }).product_id);
  assert.ok(validateBanner({ ...ok, link_type: 'category' }, { hasImage: true }).category_id);
  assert.ok(validateBanner({ ...ok, link_type: 'page', page_path: '/admin' }, { hasImage: true }).page_path);
  assert.ok(validateBanner({ ...ok, link_type: 'url', link_url: 'javascript:alert(1)' }, { hasImage: true }).link_url);
  assert.ok(validateBanner({ ...ok, starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' }, { hasImage: true }).ends_at);
  assert.ok(validateBanner({ ...ok, button_ar: 'x'.repeat(41) }, { hasImage: true }).button_ar);
  assert.equal(validateImageFile({ type: 'image/png', size: 100 }), null);
  assert.equal(validateImageFile({ type: 'image/gif', size: 100 }), 'err.invalid_image');
  assert.equal(validateImageFile({ type: 'image/png', size: 9 * 1024 * 1024 }), 'err.image_too_large');
});

test('favourites: toggle, cap, sanitize', () => {
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  assert.deepEqual(toggleFavorite([], id(1)), [id(1)]);
  assert.deepEqual(toggleFavorite([id(1), id(2)], id(1)), [id(2)]);
  assert.equal(toggleFavorite(Array.from({ length: 200 }, (_, i) => id(i)), id(999)).length, 200);
  assert.deepEqual(sanitizeFavorites([id(1), id(1), 'x', 5, null, '../../etc']), [id(1)]);
  assert.deepEqual(sanitizeFavorites('nope'), []);
});

test('duplicate-order token: same cart+details reuse the token; any change creates a new one; cleared after success', () => {
  const store = memStore(); let n = 0; const mk = () => `tok-${++n}`;
  const items = [{ productId: 'a', variantId: null, qty: 2 }, { productId: 'b', variantId: 'v', qty: 1 }];
  const form = { full_name: ' Ali ', phone: '0612345678', city: 'Fès', address: '1 rue x' };
  const s1 = checkoutSignature(items, form);
  assert.equal(getCheckoutToken(store, s1, mk), 'tok-1');
  assert.equal(getCheckoutToken(store, checkoutSignature([...items].reverse(), { ...form, full_name: 'Ali' }), mk), 'tok-1');   // order / padding irrelevant
  assert.equal(getCheckoutToken(store, checkoutSignature([{ ...items[0], qty: 3 }, items[1]], form), mk), 'tok-2');              // cart changed
  assert.equal(getCheckoutToken(store, checkoutSignature(items, { ...form, phone: '0600000000' }), mk), 'tok-3');                // customer changed
  clearCheckoutToken(store); assert.equal(store.getItem('stoph.checkout.token'), null);
  assert.equal(getCheckoutToken(store, s1, mk), 'tok-4');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(getCheckoutToken(broken, s1, mk), 'tok-5');                                                                       // storage blocked: still works
});

// ---------------- migration 12 (static checks only: the SQL has NOT been executed here) ----------------
const m12 = read('supabase/12_storefront_banners.sql');
test('migration 12: transactional, additive, RLS on every new table', () => {
  assert.match(m12, /^begin;$/m); assert.match(m12, /^commit;$/m);
  assert.doesNotMatch(m12, /drop table|truncate|delete from public\.(products|orders|categories)|alter table public\.(products|orders|order_items)\b/i);
  for (const t of ['banners', 'carousel_settings', 'order_requests']) assert.match(m12, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.match(m12, /revoke all on public\.banners from anon, authenticated/);
});
test('migration 12: visitors can only READ eligible banners; every write needs banners.manage', () => {
  assert.match(m12, /grant select on public\.banners to anon, authenticated/);
  assert.doesNotMatch(m12, /grant (insert|update|delete)[^;]*on public\.banners to[^;]*anon/i);
  assert.match(m12, /banners_public_read[\s\S]*is_active and \(starts_at is null or starts_at <= now\(\)\) and \(ends_at is null or ends_at > now\(\)\)/);
  for (const op of ['insert', 'update', 'delete']) assert.match(m12, new RegExp(`banners_staff_${op}[\\s\\S]*?has_permission\\('banners\\.manage'\\)`));
  assert.match(m12, /grant update \(autoplay, interval_seconds, transition\) on public\.carousel_settings to authenticated/);
  assert.match(m12, /link_url[\s\S]*https:\/\//);       // https-only external links
});
test('migration 12: banner bucket is separate; only banners.manage may write uuid-named images', () => {
  assert.match(m12, /file_size_limit[\s\S]*values \('banner-images', 'banner-images', true, 3145728, array\['image\/jpeg'/);
  for (const op of ['insert', 'update', 'delete']) assert.match(m12, new RegExp(`banner_images_${op} on storage\\.objects[\\s\\S]*?has_permission\\('banners\\.manage'\\)`));
  assert.match(m12, /\^\[0-9a-f-\]\{36\}\\\.\(jpg\|jpeg\|png\|webp\)\$/);
  assert.doesNotMatch(m12, /on storage\.objects[^;]*to anon/i);
});
test('migration 12: idempotent checkout keeps the create_order signature and hides the core function', () => {
  assert.match(m12, /create or replace function public\.create_order\(p_customer jsonb, p_items jsonb, p_coupon text default null\)/);
  assert.match(m12, /revoke all on function public\._create_order_core\(jsonb, jsonb, text\) from public, anon, authenticated/);
  assert.match(m12, /pg_advisory_xact_lock/);
  assert.match(m12, /grant execute on function public\.create_order\(jsonb, jsonb, text\) to anon, authenticated/);
  assert.match(m12, /raise exception 'invalid_token'/);
});
test('migration 12: best sellers exposes ids only (no sales numbers) from confirmed-or-later orders', () => {
  const fn = m12.match(/best_selling_products[\s\S]*?\$\$;/)[0];
  assert.match(fn, /returns table \(product_id uuid\)/);
  assert.match(fn, /'confirmed', 'preparing', 'shipped', 'delivered'/);
  assert.doesNotMatch(fn, /returns table \([^)]*(count|sum|quantity)/i);
});

// ---------------- front-end rules ----------------
test('no promotional banner is hard-coded in the storefront', () => {
  for (const f of ['src/pages/Home.jsx', 'src/components/HeroCarousel.jsx']) {
    const s = read(f).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(s, /https?:\/\/|unsplash|\.jpg|\.webp/i, f);
  }
  assert.match(read('src/pages/Home.jsx'), /listBanners/);
});
test('official logo assets exist with the expected dimensions', () => {
  const dims = (f) => { const b = fs.readFileSync(path.join(root, 'public/brand', f)); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(dims('og-image.png'), [1200, 630]);
  assert.deepEqual(dims('icon-512.png'), [512, 512]); assert.deepEqual(dims('icon-192.png'), [192, 192]); assert.deepEqual(dims('apple-touch-icon.png'), [180, 180]);
  const [w, h] = dims('logo-wordmark.png'); assert.ok(w / h > 5 && w / h < 7);
  assert.match(read('index.html'), /viewport-fit=cover/);
});
const PALETTE = { black: '#111111', brown: '#5C3828', gold: '#D6B878', goldSoft: '#E8D5A3', white: '#F5F1E8', gray: '#A8A29E' };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const themeTokens = (theme) => Object.fromEntries([...read('src/styles.css').match(new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`))[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));

test('STOPH palette: the six brand colours are defined exactly once as source tokens', () => {
  const css = read('src/styles.css');
  const root = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  assert.match(root, /--c-black:\s*#111111/i); assert.match(root, /--c-brown:\s*#5C3828/i); assert.match(root, /--c-gold:\s*#D6B878/i);
  assert.match(root, /--c-gold-soft:\s*#E8D5A3/i); assert.match(root, /--c-white:\s*#F5F1E8/i); assert.match(root, /--c-gray:\s*#A8A29E/i);
  assert.match(root, /--red:\s*var\(--c-gold\)/);               // legacy "primary" token now resolves to gold
  assert.equal(themeTokens('dark').bg, PALETTE.black); assert.equal(themeTokens('dark').text, PALETTE.white); assert.equal(themeTokens('dark').muted, PALETTE.gray);
});
test('STOPH palette: no legacy brand colours or random hues remain anywhere in the stylesheet / static head', () => {
  const css = read('src/styles.css') + read('index.html') + read('public/favicon.svg');
  for (const old of ['e10600', 'bf0500', 'fed70a', 'fe9201', 'f9030a', '5c0000', '050404', '0b0b0c', 'ff5a52', 'd4252c', '6fcf97', 'ff6b6b']) assert.ok(!css.toLowerCase().includes(old), `legacy colour #${old} still present`);
  const allowed = new Set(['#111111', '#5C3828', '#D6B878', '#E8D5A3', '#F5F1E8', '#A8A29E',            // the brand palette
    '#3F291F', '#2F211A', '#4A3F2E', '#3B3124', '#1E1712', '#2A1B14',                                   // brown/black blends (cards, fields, borders)
    '#FBF8F1', '#EBE3D1', '#D6C9AE', '#5E5650',                                                         // light-theme warm tints
    '#E8998A', '#9A3B2B',                                                                               // error text only (dark / light)
    '#FFF']);                                                                                           // QR-code background (must stay white to be scannable)
  const found = new Set([...read('src/styles.css').matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toUpperCase()));
  assert.deepEqual([...found].filter((c) => !allowed.has(c)), []);
  assert.doesNotMatch(read('src/styles.css'), /\b(blue|green|purple|violet|pink|teal|cyan)\b|hsl\(/i);
});
test('STOPH palette: required pairings meet WCAG AA (4.5:1 text, 3:1 UI)', () => {
  const P = PALETTE; const fails = [];
  const need = (name, a, b, min = 4.5) => { const r = ratio(a, b); if (r < min) fails.push(`${name}: ${r.toFixed(2)} < ${min}`); };
  need('warm white on black', P.white, P.black); need('gray on black', P.gray, P.black); need('gold on black (icons/links)', P.gold, P.black);
  need('black on gold (primary button)', P.black, P.gold); need('black on soft gold (hover)', P.black, P.goldSoft);
  need('warm white on brown (selected, badges)', P.white, P.brown); need('gold on brown (badge border/icons)', P.gold, P.brown, 3);
  const d = themeTokens('dark'); const l = themeTokens('light');
  for (const bg of ['bg', 'surface', 'surface-2']) { for (const fg of ['text', 'muted', 'silver', 'ok', 'bad']) need(`dark ${fg} on ${bg}`, d[fg], d[bg]); need(`dark focus ring on ${bg}`, d.focus, d[bg], 3); }
  for (const bg of ['bg', 'surface', 'surface-2']) { for (const fg of ['text', 'muted', 'silver', 'ok', 'bad', 'accent-strong']) need(`light ${fg} on ${bg}`, l[fg], l[bg]); need(`light focus ring on ${bg}`, l.focus, l[bg], 3); }
  need('dark: border visible against page', d.border, d.bg, 1.5);
  assert.deepEqual(fails, []);
});
test('STOPH palette: header, footer and bottom navigation are black in BOTH themes; focus ring on them is gold', () => {
  const css = read('src/styles.css');
  assert.match(css, /--brand-black:\s*var\(--c-black\)/);
  assert.match(css, /\.store-header \{ background: var\(--brand-black\)/);
  assert.match(css, /\.site-footer \{ background: var\(--brand-black\)/);
  assert.match(css, /\.bottom-nav \{[^}]*background: var\(--brand-black\)/);
  assert.match(css, /\.store-header :focus-visible[^{]*\{ outline-color: var\(--yellow\)/);
});
test('translations: new storefront/admin keys exist in both languages (also covered by phase3 suite)', async () => {
  const { dictionary } = await import('../src/i18n/dictionary.js');
  for (const k of ['carousel.pause', 'banners.title', 'banners.preview', 'cart.clear', 'fav.add', 'err.invalid_token', 'err.banner_bad_url', 'home.bestSellers']) {
    assert.ok(dictionary.ar[k] && dictionary.fr[k], k);
  }
});
