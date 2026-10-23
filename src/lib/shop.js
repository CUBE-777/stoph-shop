// Pure business helpers (no React, no network) — unit-tested in tests/shop.test.js.
// The server (create_order) re-checks everything here; this file only drives the UI.

export const MAX_QTY = 20;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function toLatinDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

// Same rule as the SQL function: 06/07/05 + 8 digits, or +212 / 00212 prefix.
export function normalizePhone(raw) {
  let p = toLatinDigits(raw).replace(/[\s\-.]/g, '');
  if (p.startsWith('+212')) p = '0' + p.slice(4);
  else if (p.startsWith('00212')) p = '0' + p.slice(5);
  return /^0[5-7]\d{8}$/.test(p) ? p : null;
}

// A sale price counts only inside its (optional) time window. The server applies the same rule with its own clock.
export function saleActive(p, now = new Date()) {
  if (p.sale_price == null || !(Number(p.sale_price) < Number(p.price))) return false;
  const start = p.sale_starts_at ? new Date(p.sale_starts_at) : null;
  const end = p.sale_ends_at ? new Date(p.sale_ends_at) : null;
  return (!start || start <= now) && (!end || end > now);
}
export function unitPrice(p, now = new Date()) {
  return saleActive(p, now) ? Number(p.sale_price) : Number(p.price);
}
export const isOnSale = (p, now) => saleActive(p, now);
export function discountPercent(p, now) {
  return saleActive(p, now) ? Math.round((1 - Number(p.sale_price) / Number(p.price)) * 100) : 0;
}

// A product with variants is available if at least one variant is available.
// A simple product uses its own flag. (Hidden products are never fetched.)
export function productAvailability(p) {
  const vs = p.product_variants || [];
  if (vs.length === 0) return { hasVariants: false, available: !!p.is_available };
  return { hasVariants: true, available: vs.some((v) => v.is_available) };
}

export function validateCheckout(f) {
  const e = {};
  const name = (f.full_name || '').trim();
  const city = (f.city || '').trim();
  const address = (f.address || '').trim();
  if (name.length < 2 || name.length > 100) e.full_name = 'invalid_name';
  if (!normalizePhone(f.phone)) e.phone = 'invalid_phone';
  if (city.length < 2 || city.length > 60) e.city = 'invalid_city';
  if (address.length < 5 || address.length > 300) e.address = 'invalid_address';
  if ((f.notes || '').trim().length > 500) e.notes = 'invalid_notes';
  return e;
}

export const lineKey = (productId, variantId) => `${productId}:${variantId || '-'}`;

export function addToCart(items, item) {
  const key = lineKey(item.productId, item.variantId);
  const i = items.findIndex((x) => lineKey(x.productId, x.variantId) === key);
  if (i === -1) return [...items, { ...item, qty: Math.min(item.qty, MAX_QTY) }];
  const next = items.slice();
  next[i] = { ...next[i], ...item, qty: Math.min(next[i].qty + item.qty, MAX_QTY) };
  return next;
}
export function setQty(items, key, qty) {
  const q = Math.max(1, Math.min(MAX_QTY, Math.floor(qty) || 1));
  return items.map((x) => (lineKey(x.productId, x.variantId) === key ? { ...x, qty: q } : x));
}
export const removeLine = (items, key) => items.filter((x) => lineKey(x.productId, x.variantId) !== key);
// Money is added in integer minor units (centimes) so 19.99 x 3 is exactly 59.97, never 59.97000000000001.
export const toMinor = (x) => Math.round((Number(x) || 0) * 100);
export const fromMinor = (m) => m / 100;
export const lineTotal = (price, qty) => fromMinor(toMinor(price) * qty);
export const cartSubtotal = (items) => fromMinor(items.reduce((s, x) => s + toMinor(x.price) * x.qty, 0));
export const cartCount = (items) => items.reduce((s, x) => s + x.qty, 0);

// Preview only — the server computes the real fee.
// Mirrors SQL city_key(): lower-case, French accents removed, punctuation/spaces collapsed.
export function cityKey(s) {
  return String(s ?? '').trim().toLowerCase()
    .replace(/[àâäáã]/g, 'a').replace(/ç/g, 'c').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i').replace(/ñ/g, 'n')
    .replace(/[óòôöõ]/g, 'o').replace(/[úùûü]/g, 'u').replace(/[ýÿ]/g, 'y')
    .replace(/[\s\-_'’.]+/g, ' ').trim();
}
export function pickShippingFee(rates, city) {
  const c = cityKey(city);
  const exact = rates.find((r) => !r.is_default && r.city && cityKey(r.city) === c);
  if (exact) return Number(exact.fee);
  const def = rates.find((r) => r.is_default);
  return def ? Number(def.fee) : null;
}

export const ORDER_STATUSES = ['new', 'pending_confirmation', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'];

// from -> { to: permission required }. MUST mirror the order_transitions table (the server is the authority).
export const ORDER_TRANSITIONS = {
  new: { pending_confirmation: 'orders.update_status', confirmed: 'orders.update_status', cancelled: 'orders.cancel' },
  pending_confirmation: { confirmed: 'orders.update_status', cancelled: 'orders.cancel' },
  confirmed: { preparing: 'orders.update_status', shipped: 'orders.update_status', cancelled: 'orders.cancel' },
  preparing: { shipped: 'orders.update_status', cancelled: 'orders.cancel' },
  shipped: { delivered: 'orders.update_status', returned: 'orders.cancel' },
  delivered: { returned: 'orders.cancel' },
  cancelled: {},
  returned: {},
};
export const canTransition = (from, to) => Object.hasOwn(ORDER_TRANSITIONS[from] || {}, to);
// Next statuses this staff member may choose (can = (permission) => boolean).
export const allowedNextStatuses = (from, can) =>
  Object.entries(ORDER_TRANSITIONS[from] || {}).filter(([, perm]) => can(perm)).map(([to]) => to);

// ---- phone / WhatsApp (manual sending only: we just open a prepared chat) ----
export function toIntlPhone(raw) {
  const p = normalizePhone(raw);
  return p ? `212${p.slice(1)}` : null;
}
export function whatsappMessage(lang, { firstName, orderNumber, items, total, currency, city, trackUrl }) {
  const list = items.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty}`).join('\n');
  if (lang === 'fr') {
    return `Bonjour ${firstName},\nVotre commande #${orderNumber} chez Stoph Shop :\n${list}\nTotal à payer à la livraison : ${total} ${currency}\nVille : ${city}\n${trackUrl ? `Suivi : ${trackUrl}\n` : ''}Pouvez-vous confirmer votre commande ? Merci !`;
  }
  return `مرحباً ${firstName}،\nطلبك رقم #${orderNumber} من Stoph Shop:\n${list}\nالمبلغ المطلوب عند الاستلام: ${total} ${currency}\nالمدينة: ${city}\n${trackUrl ? `التتبع: ${trackUrl}\n` : ''}هل تؤكد طلبك؟ شكراً!`;
}
export function whatsappUrl(phone, text) {
  const intl = toIntlPhone(phone);
  return intl ? `https://wa.me/${intl}?text=${encodeURIComponent(text)}` : null;
}

export const TRACKING_CODE_RE = /^SS-[0-9A-F]{10}$/;
export const normalizeTrackingCode = (s) => String(s || '').trim().toUpperCase();
export const normalizeCoupon = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---- Phase 3: returns & cancellations (mirror of migration 11; the server is the authority) ----
export const RETURN_REASONS = ['customer_changed_mind', 'defective', 'wrong_item', 'not_as_described', 'refused_at_delivery', 'unreachable', 'duplicate_order', 'out_of_stock', 'other'];
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'closed'];
export const RETURN_TRANSITIONS = { requested: ['approved', 'rejected'], approved: ['received'], rejected: [], received: [], closed: [] };
export const canReturnTransition = (from, to) => (RETURN_TRANSITIONS[from] || []).includes(to);
// A return can be registered only for shipped / delivered orders; cancelling only before shipping.
export const canRegisterReturn = (orderStatus) => ['shipped', 'delivered'].includes(orderStatus);
export const canCancelOrder = (orderStatus) => ['new', 'pending_confirmation', 'confirmed', 'preparing'].includes(orderStatus);
// Reason "other" needs a written note (same rule as the server's note_required).
export function validateReason(reason, note) {
  if (!RETURN_REASONS.includes(reason)) return 'invalid_reason';
  const n = String(note || '').trim();
  if (n.length > 500) return 'invalid_notes';
  if (reason === 'other' && n.length < 3) return 'note_required';
  return null;
}
// Generic status path may NOT reach cancelled/returned any more.
export const GENERIC_STATUS_TARGETS = (from, can) => allowedNextStatuses(from, can).filter((s) => s !== 'cancelled' && s !== 'returned');

// ---- Phase 3: MFA gate decisions (what the admin app shows after sign-in) ----
// aal: {currentLevel, nextLevel} from supabase.auth.mfa.getAuthenticatorAssuranceLevel(); status: mfa_status() RPC.
export function mfaGate(aal, status) {
  const hasFactor = aal?.nextLevel === 'aal2';
  if (hasFactor && aal.currentLevel !== 'aal2') return 'challenge';           // enrolled: must enter a code
  if (status?.enforced && status?.required && !hasFactor) return 'enroll';   // required but nothing enrolled yet
  return 'ok';
}

// ---- Phase 3: image upload sizing (client-side compression, free; Supabase image transformations are a paid feature) ----
export function fitWithin(width, height, max = 1600) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// ---- Phase 3: SEO helpers ----
export function sitemapXml(origin, products, now = new Date()) {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const urls = ['/', '/products', '/track', '/delivery', '/contact'].map((p) => ({ loc: `${origin}${p}` }))
    .concat(products.map((p) => ({ loc: `${origin}/products/${p.slug}`, lastmod: (p.updated_at || now.toISOString()).slice(0, 10) })));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
export const truncateText = (s, n = 155) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };

// ---------------------------------------------------------------------------------------------------------
// Storefront upgrade helpers (pure, unit-tested)
// ---------------------------------------------------------------------------------------------------------

// Cart restored from localStorage: drop anything malformed, clamp quantities, never trust stored numbers blindly.
export function sanitizeCart(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x.productId === 'string' && x.productId && Number.isFinite(Number(x.price)) && Number(x.price) >= 0 && Number.isFinite(Number(x.qty)))
    .map((x) => ({ ...x, price: Number(x.price), qty: Math.max(1, Math.min(MAX_QTY, Math.floor(Number(x.qty)) || 1)) }));
}

// ---- promotional carousel ----
export const CAROUSEL_DEFAULTS = { autoplay: true, interval_seconds: 5, transition: 'slide' };
export const clampInterval = (s) => Math.max(3, Math.min(15, Math.round(Number(s)) || 5));
export const carouselSettings = (row) => ({
  autoplay: row?.autoplay !== false,
  interval_seconds: clampInterval(row?.interval_seconds),
  transition: row?.transition === 'fade' ? 'fade' : 'slide',
});
// Mirror of the RLS rule (enabled AND inside the schedule). The database is the real gate; this is for previews/tests.
export function bannerEligible(b, now = new Date()) {
  if (!b || !b.is_active) return false;
  if (b.starts_at && new Date(b.starts_at) > now) return false;
  if (b.ends_at && new Date(b.ends_at) <= now) return false;
  return true;
}
export const sortBanners = (list) => [...list].sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
export const slideIndex = (i, len, dir) => (len <= 0 ? 0 : (((i + dir) % len) + len) % len);
// Horizontal swipe -> -1 (next) / +1 (previous) / 0 (ignore). dir: 'ltr' | 'rtl'. Vertical scrolls are ignored.
export function swipeDirection(dx, dy, rtl = false, min = 40) {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  const forward = rtl ? dx > 0 : dx < 0;
  return forward ? 1 : -1;
}
// A banner destination as an in-app route or an https URL. Anything else (javascript:, data:, //host) yields null.
export function isSafeInternalPath(p) { return typeof p === 'string' && /^\/([^/\s][^\s]*)?$/.test(p); }
export function isSafeHttpsUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' && !!x.hostname; } catch { return false; } }
export function resolveBannerLink(b) {
  if (!b) return null;
  if (b.link_type === 'product') return b.products?.slug ? { to: `/products/${b.products.slug}` } : null;
  if (b.link_type === 'category') return b.categories?.slug ? { to: `/products?category=${encodeURIComponent(b.categories.slug)}` } : null;
  if (b.link_type === 'page') return ['/', '/products', '/track', '/delivery', '/contact'].includes(b.page_path) ? { to: b.page_path } : null;
  if (b.link_type === 'url') {
    if (isSafeInternalPath(b.link_url)) return { to: b.link_url };
    if (isSafeHttpsUrl(b.link_url)) return { href: b.link_url };
  }
  return null;
}
export const bannerText = (b, field, lang) => (lang === 'fr' ? b[`${field}_fr`] || b[`${field}_ar`] : b[`${field}_ar`] || b[`${field}_fr`]) || '';

// ---- favorites (stored in this browser only; no customer accounts exist) ----
export const toggleFavorite = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, 200));
export const sanitizeFavorites = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 200) : []);

// ---- duplicate-order protection ----
// One random token per distinct checkout attempt. Same cart + same customer data => same token, so a retry after
// a timeout (or a double tap) maps to the same order on the server. Any change to the cart/data => new token.
export function checkoutSignature(items, form) {
  return JSON.stringify([items.map((i) => [i.productId, i.variantId || null, i.qty]).sort(), form.full_name?.trim(), form.phone, form.city?.trim(), form.address?.trim()]);
}
export function getCheckoutToken(store, signature, makeId) {
  try {
    const cur = JSON.parse(store.getItem('stoph.checkout.token') || 'null');
    if (cur && cur.sig === signature && cur.token) return cur.token;
  } catch { /* fall through */ }
  const token = makeId();
  try { store.setItem('stoph.checkout.token', JSON.stringify({ sig: signature, token })); } catch { /* private mode: token still works for this attempt */ }
  return token;
}
export const clearCheckoutToken = (store) => { try { store.removeItem('stoph.checkout.token'); } catch { /* ignore */ } };

// ---- admin banners ----
export const BANNER_SIZES = { desktop: '1600 × 600 px (8:3)', mobile: '900 × 675 px (4:3)' };
export function bannerStatus(b, now = new Date()) {
  if (!b.is_active) return 'disabled';
  if (b.starts_at && new Date(b.starts_at) > now) return 'scheduled';
  if (b.ends_at && new Date(b.ends_at) <= now) return 'expired';
  return 'live';
}
// <input type="datetime-local"> works in the admin's local time; the database stores an absolute instant (timestamptz).
const p2 = (n) => String(n).padStart(2, '0');
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
// Returns { field: errorKey } — empty object means valid. `hasImage` = a stored or newly chosen desktop image exists.
export function validateBanner(b, { hasImage }) {
  const e = {};
  if (!String(b.title_ar || '').trim() || String(b.title_ar).length > 120) e.title_ar = 'err.invalid_title';
  if (!String(b.title_fr || '').trim() || String(b.title_fr).length > 120) e.title_fr = 'err.invalid_title';
  if (String(b.subtitle_ar || '').length > 240) e.subtitle_ar = 'err.invalid_notes';
  if (String(b.subtitle_fr || '').length > 240) e.subtitle_fr = 'err.invalid_notes';
  if (String(b.button_ar || '').length > 40) e.button_ar = 'err.invalid_notes';
  if (String(b.button_fr || '').length > 40) e.button_fr = 'err.invalid_notes';
  if (b.link_type === 'product' && !b.product_id) e.product_id = 'err.banner_pick_product';
  if (b.link_type === 'category' && !b.category_id) e.category_id = 'err.banner_pick_category';
  if (b.link_type === 'page' && !['/', '/products', '/track', '/delivery', '/contact'].includes(b.page_path)) e.page_path = 'err.banner_pick_page';
  if (b.link_type === 'url' && !(isSafeInternalPath(b.link_url) || isSafeHttpsUrl(b.link_url))) e.link_url = 'err.banner_bad_url';
  if (b.starts_at && b.ends_at && new Date(b.ends_at) <= new Date(b.starts_at)) e.ends_at = 'err.banner_dates';
  if (b.is_active && !hasImage) e.image = 'err.banner_need_image';
  return e;
}
export function validateImageFile(file, maxBytes = 8 * 1024 * 1024) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'err.invalid_image';
  if (file.size > maxBytes) return 'err.image_too_large';
  return null;
}
