import { supabase } from '../lib/supabase.js';
import { bannerEligible, carouselSettings, saleActive, sortBanners } from '../lib/shop.js';

// Listing cards need far fewer columns than the detail page (no descriptions): smaller payloads.
const CARD_SELECT = 'id, slug, name_ar, name_fr, price, sale_price, sale_starts_at, sale_ends_at, is_available, is_featured, created_at, product_images(path, alt, sort_order), product_variants(id, is_available)';
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

// offset + limit = one page ("load more" appends the next page instead of re-downloading everything).
export async function listProducts({ categoryId, search, sort = 'new', minPrice, maxPrice, featured, limit = PAGE_SIZE, offset = 0 } = {}) {
  let q = supabase.from('products').select(CARD_SELECT);
  if (categoryId) q = q.eq('category_id', categoryId);
  if (featured) q = q.eq('is_featured', true);
  if (minPrice !== '' && minPrice != null && !Number.isNaN(Number(minPrice))) q = q.gte('price', Number(minPrice));
  if (maxPrice !== '' && maxPrice != null && !Number.isNaN(Number(maxPrice))) q = q.lte('price', Number(maxPrice));
  const term = (search || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (term) q = q.or(`name_ar.ilike.%${term}%,name_fr.ilike.%${term}%`);
  if (sort === 'priceAsc') q = q.order('price', { ascending: true });
  else if (sort === 'priceDesc') q = q.order('price', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  q = q.order('id'); // stable order across pages when prices tie
  const { data, error } = await q.range(offset, offset + limit - 1);
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
export async function placeOrder(form, items, coupon, clientToken) {
  const { data, error } = await supabase.rpc('create_order', {
    p_customer: {
      full_name: form.full_name.trim(), phone: form.phone, city: form.city.trim(),
      address: form.address.trim(), notes: (form.notes || '').trim(),
      client_token: clientToken || undefined,   // server returns the same order for a repeated token (needs migration 12)
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

// ---- storefront home: promotional carousel & discovery rows (all read-only, all governed by RLS) ----
// Visitors only receive eligible banners from the database (RLS); we filter again so a logged-in admin, who can
// read every banner, still sees the same public carousel on the storefront.
export async function listBanners() {
  const { data, error } = await supabase.from('banners').select('*, products(slug), categories(slug)').order('sort_order').order('created_at');
  fail(error);
  return sortBanners((data || []).filter((b) => bannerEligible(b)));
}
export async function getCarouselSettings() {
  const { data, error } = await supabase.from('carousel_settings').select('autoplay, interval_seconds, transition').eq('id', 1).maybeSingle();
  fail(error);
  return carouselSettings(data);
}
export async function listBestSellers(limit = 8) {
  const { data: ranked, error } = await supabase.rpc('best_selling_products', { p_limit: limit });
  fail(error);
  const ids = (ranked || []).map((r) => r.product_id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from('products').select(CARD_SELECT).in('id', ids);
  fail(e2);
  const byId = new Map(data.map((p) => [p.id, sortChildren(p)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
// Only products whose sale price is really active right now (price window checked, nothing invented).
export async function listOnSale(limit = 8) {
  const { data, error } = await supabase.from('products').select(CARD_SELECT).not('sale_price', 'is', null).order('created_at', { ascending: false }).limit(60);
  fail(error);
  return data.map(sortChildren).filter((p) => saleActive(p)).slice(0, limit);
}
export async function listRelated(product, limit = 4) {
  if (!product?.category_id) return [];
  const { data, error } = await supabase.from('products').select(CARD_SELECT).eq('category_id', product.category_id).neq('id', product.id).order('created_at', { ascending: false }).limit(limit);
  fail(error);
  return data.map(sortChildren);
}
export async function listProductsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('products').select(CARD_SELECT).in('id', ids);
  fail(error);
  const byId = new Map(data.map((p) => [p.id, sortChildren(p)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);     // keeps the favourites order; deleted/hidden products simply disappear
}
