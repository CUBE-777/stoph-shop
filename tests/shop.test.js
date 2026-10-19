import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, unitPrice, discountPercent, productAvailability, validateCheckout,
  addToCart, setQty, removeLine, cartSubtotal, lineKey, pickShippingFee, canTransition, slugify, MAX_QTY,
  saleActive, allowedNextStatuses, ORDER_TRANSITIONS, ORDER_STATUSES, toIntlPhone, whatsappMessage, whatsappUrl,
  normalizeTrackingCode, normalizeCoupon, TRACKING_CODE_RE,
} from '../src/lib/shop.js';

test('phone normalisation accepts Moroccan formats and rejects junk', () => {
  assert.equal(normalizePhone('0612345678'), '0612345678');
  assert.equal(normalizePhone('+212 612-345-678'), '0612345678');
  assert.equal(normalizePhone('00212712345678'), '0712345678');
  assert.equal(normalizePhone('٠٦١٢٣٤٥٦٧٨'), '0612345678');
  assert.equal(normalizePhone('0412345678'), null);
  assert.equal(normalizePhone('12345'), null);
});

test('pricing: sale price wins only when lower than price', () => {
  assert.equal(unitPrice({ price: 100, sale_price: 80 }), 80);
  assert.equal(unitPrice({ price: 100, sale_price: null }), 100);
  assert.equal(unitPrice({ price: 100, sale_price: 120 }), 100);
  assert.equal(discountPercent({ price: 100, sale_price: 75 }), 25);
});

test('availability rules', () => {
  assert.deepEqual(productAvailability({ is_available: true, product_variants: [] }), { hasVariants: false, available: true });
  assert.equal(productAvailability({ is_available: true }).available, true);
  assert.equal(productAvailability({ is_available: false, product_variants: [] }).available, false);
  assert.equal(productAvailability({ is_available: false, product_variants: [{ is_available: false }, { is_available: true }] }).available, true);
  assert.equal(productAvailability({ is_available: true, product_variants: [{ is_available: false }] }).available, false);
});

test('checkout validation', () => {
  const ok = { full_name: 'Sara B', phone: '0612345678', city: 'Fès', address: '12 rue des Fleurs', notes: '' };
  assert.deepEqual(validateCheckout(ok), {});
  const bad = validateCheckout({ full_name: 'S', phone: '1', city: '', address: 'abc', notes: 'x'.repeat(501) });
  assert.deepEqual(Object.keys(bad).sort(), ['address', 'city', 'full_name', 'notes', 'phone']);
});

test('cart: merge, cap, set quantity, remove, subtotal', () => {
  const a = { productId: 'p1', variantId: null, qty: 2, price: 50 };
  let cart = addToCart([], a);
  cart = addToCart(cart, { ...a, qty: 3 });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 5);
  cart = addToCart(cart, { ...a, qty: 100 });
  assert.equal(cart[0].qty, MAX_QTY);
  cart = addToCart(cart, { productId: 'p1', variantId: 'v1', qty: 1, price: 50 });
  assert.equal(cart.length, 2);
  cart = setQty(cart, lineKey('p1', 'v1'), 4);
  assert.equal(cartSubtotal(cart), 50 * MAX_QTY + 200);
  assert.equal(setQty(cart, lineKey('p1', 'v1'), 0)[1].qty, 1);
  assert.equal(removeLine(cart, lineKey('p1', null)).length, 1);
});

test('shipping fee preview: city rate or default', () => {
  const rates = [{ city: null, fee: 40, is_default: true }, { city: 'Casablanca', fee: 25, is_default: false }];
  assert.equal(pickShippingFee(rates, ' casablanca '), 25);
  assert.equal(pickShippingFee(rates, 'Fès'), 40);
  assert.equal(pickShippingFee([], 'Fès'), null);
});

test('order status transitions', () => {
  assert.ok(canTransition('pending_confirmation', 'confirmed'));
  assert.ok(canTransition('shipped', 'delivered'));
  assert.ok(!canTransition('pending_confirmation', 'delivered'));
  assert.ok(!canTransition('cancelled', 'confirmed'));
  assert.ok(!canTransition('delivered', 'cancelled'));
});

test('slugify', () => {
  assert.equal(slugify('Montre Élégante 2'), 'montre-elegante-2');
  assert.equal(slugify('ساعة'), '');
});

test('sale window: only active inside its dates', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const base = { price: 100, sale_price: 70 };
  assert.equal(saleActive(base, now), true);
  assert.equal(saleActive({ ...base, sale_starts_at: '2026-06-16T00:00:00Z' }, now), false);
  assert.equal(saleActive({ ...base, sale_ends_at: '2026-06-14T00:00:00Z' }, now), false);
  assert.equal(saleActive({ ...base, sale_starts_at: '2026-06-01T00:00:00Z', sale_ends_at: '2026-07-01T00:00:00Z' }, now), true);
  assert.equal(unitPrice({ ...base, sale_ends_at: '2026-06-14T00:00:00Z' }, now), 100);
  assert.equal(discountPercent({ ...base, sale_ends_at: '2026-06-14T00:00:00Z' }, now), 0);
});

test('role-based transitions: support cannot cancel, manager can', () => {
  const support = new Set(['orders.view', 'orders.update_status']);
  const manager = new Set(['orders.view', 'orders.update_status', 'orders.cancel']);
  assert.deepEqual(allowedNextStatuses('pending_confirmation', (p) => support.has(p)), ['confirmed']);
  assert.deepEqual(allowedNextStatuses('pending_confirmation', (p) => manager.has(p)).sort(), ['cancelled', 'confirmed']);
  assert.deepEqual(allowedNextStatuses('cancelled', () => true), []);
});

test('transition table is consistent with the statuses list', () => {
  for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
    assert.ok(ORDER_STATUSES.includes(from));
    for (const to of Object.keys(tos)) assert.ok(ORDER_STATUSES.includes(to), `${from}->${to}`);
  }
  assert.ok(canTransition('confirmed', 'preparing'));
  assert.ok(!canTransition('preparing', 'delivered'));
});

test('WhatsApp: international number and limited message (no full address)', () => {
  assert.equal(toIntlPhone('0612345678'), '212612345678');
  assert.equal(toIntlPhone('bad'), null);
  const msg = whatsappMessage('fr', { firstName: 'Sara', orderNumber: 1001, items: [{ name: 'Montre', variant: 'Noir', qty: 2 }], total: 240, currency: 'MAD', city: 'Fès', trackUrl: 'https://x.test/track?code=SS-ABCDEF0123' });
  assert.match(msg, /#1001/);
  assert.match(msg, /Montre \(Noir\) × 2/);
  const url = whatsappUrl('0612345678', msg);
  assert.ok(url.startsWith('https://wa.me/212612345678?text='));
  assert.equal(whatsappUrl('bad', msg), null);
  assert.match(whatsappMessage('ar', { firstName: 'سارة', orderNumber: 5, items: [], total: 1, currency: 'درهم', city: 'فاس' }), /طلبك رقم #5/);
});

test('tracking code and coupon normalisation', () => {
  assert.equal(normalizeTrackingCode('  ss-abcdef0123 '), 'SS-ABCDEF0123');
  assert.ok(TRACKING_CODE_RE.test('SS-ABCDEF0123'));
  assert.ok(!TRACKING_CODE_RE.test('SS-ZZZ'));
  assert.equal(normalizeCoupon(' welcome 10 '), 'WELCOME10');
});
