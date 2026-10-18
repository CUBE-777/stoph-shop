import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, unitPrice, discountPercent, productAvailability, validateCheckout,
  addToCart, setQty, removeLine, cartSubtotal, lineKey, pickShippingFee, canTransition, slugify, MAX_QTY,
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
