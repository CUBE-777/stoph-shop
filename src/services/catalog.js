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

// The only write a visitor can make. Prices/fees are NOT sent: the server computes them.
export async function placeOrder(form, items) {
  const { data, error } = await supabase.rpc('create_order', {
    p_customer: {
      full_name: form.full_name.trim(), phone: form.phone, city: form.city.trim(),
      address: form.address.trim(), notes: (form.notes || '').trim(),
    },
    p_items: items.map((i) => ({ product_id: i.productId, variant_id: i.variantId || null, quantity: i.qty })),
  });
  fail(error);
  return data;
}
