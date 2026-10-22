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
export const cartSubtotal = (items) => items.reduce((s, x) => s + Number(x.price) * x.qty, 0);
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
