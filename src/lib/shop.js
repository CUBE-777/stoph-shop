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

export function unitPrice(p) {
  const price = Number(p.price);
  const sale = p.sale_price == null ? null : Number(p.sale_price);
  return sale != null && sale < price ? sale : price;
}
export const isOnSale = (p) => unitPrice(p) < Number(p.price);
export function discountPercent(p) {
  return isOnSale(p) ? Math.round((1 - unitPrice(p) / Number(p.price)) * 100) : 0;
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
export function pickShippingFee(rates, city) {
  const c = (city || '').trim().toLowerCase();
  const exact = rates.find((r) => !r.is_default && r.city && r.city.toLowerCase() === c);
  if (exact) return Number(exact.fee);
  const def = rates.find((r) => r.is_default);
  return def ? Number(def.fee) : null;
}

export const ORDER_STATUSES = ['pending_confirmation', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'];
export const ORDER_TRANSITIONS = {
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
export const canTransition = (from, to) => (ORDER_TRANSITIONS[from] || []).includes(to);

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
