import { supabase } from '../lib/supabase.js';

const PRODUCT_SELECT = '*, product_images(path, alt, sort_order), product_variants(*), categories(slug, name_ar, name_fr)';
const sortChildren = (p) => ({
  ...p,
  product_images: [...(p.product_images || [])].sort((a, b) => a.sort_order - b.sort_order),
  product_variants: [...(p.product_variants || [])].sort((a, b) => a.sort_order - b.sort_order),
});
const fail = (error) => { if (error) throw error; };

export async function listCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('sort_order').order('name_fr');
  fail(error);
  return data;
}

export const PAGE_SIZE = 24;

export async function listProducts({ categoryId, search, sort = 'new', minPrice, maxPrice, featured, limit = PAGE_SIZE } = {}) {
  let q = supabase.from('products').select(PRODUCT_SELECT);
  if (categoryId) q = q.eq('category_id', categoryId);
  if (featured) q = q.eq('is_featured', true);
  if (minPrice !== '' && minPrice != null && !Number.isNaN(Number(minPrice))) q = q.gte('price', Number(minPrice));
  if (maxPrice !== '' && maxPrice != null && !Number.isNaN(Number(maxPrice))) q = q.lte('price', Number(maxPrice));
  const term = (search || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (term) q = q.or(`name_ar.ilike.%${term}%,name_fr.ilike.%${term}%`);
  if (sort === 'priceAsc') q = q.order('price', { ascending: true });
  else if (sort === 'priceDesc') q = q.order('price', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  const { data, error } = await q.limit(limit);
  fail(error);
  return data.map(sortChildren);
}

export async function getProductBySlug(slug) {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('slug', slug).maybeSingle();
  fail(error);
  return data ? sortChildren(data) : null;
}

export async function fetchProductsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('products').select('*, product_variants(*)').in('id', ids);
  fail(error);
  return data;
}

export async function getShippingRates() {
  const { data, error } = await supabase.from('shipping_rates').select('*').eq('is_active', true);
  fail(error);
  return data;
}

const cartPayload = (items) => items.map((i) => ({ product_id: i.productId, variant_id: i.variantId || null, quantity: i.qty }));

// Server-computed totals for the checkout page (no write). Prices/fees/discounts are never sent by the browser.
export async function quoteOrder(items, city, coupon, phone) {
  const { data, error } = await supabase.rpc('quote_order', {
    p_items: cartPayload(items), p_city: city || null, p_coupon: coupon || null, p_phone: phone || null,
  });
  fail(error);
  return data; // { subtotal, product_discount, coupon_discount, shipping_fee, total, coupon_code } or { error }
}

// The only write a visitor can make. Coupon problems come back as { error } so they can be rate limited.
export async function placeOrder(form, items, coupon) {
  const { data, error } = await supabase.rpc('create_order', {
    p_customer: {
      full_name: form.full_name.trim(), phone: form.phone, city: form.city.trim(),
      address: form.address.trim(), notes: (form.notes || '').trim(),
    },
    p_items: cartPayload(items),
    p_coupon: coupon || null,
  });
  fail(error);
  if (data?.error) { const e = new Error(data.error); throw e; }
  return data;
}

// Public tracking: code + phone, answered by a limited server function (never a table read).
export async function trackOrder(code, phone) {
  const { data, error } = await supabase.rpc('track_order', { p_code: code, p_phone: phone });
  fail(error);
  return data; // { found: false } | { found: true, status, items, history, ... }
}
