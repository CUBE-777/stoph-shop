// Admin data layer. Every call runs as the signed-in staff user; RLS and the
// database functions decide what is allowed — nothing here is trusted by the server.
import { BUCKET, supabase } from '../lib/supabase.js';
import { slugify } from '../lib/shop.js';

const ok = ({ data, error }) => { if (error) throw error; return data; };

// ---- auth ----
export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password }).then(ok);
export const signOut = () => supabase.auth.signOut();
export const getSession = () => supabase.auth.getSession().then((r) => r.data.session);
export const onAuthChange = (cb) => supabase.auth.onAuthStateChange((_e, s) => cb(s)).data.subscription;
export const myPermissions = () => supabase.rpc('my_permissions').then(ok);

// ---- dashboard ----
export const dashboard = () => supabase.rpc('admin_dashboard').then(ok);

// ---- categories ----
export const adminCategories = () => supabase.from('categories').select('*').order('sort_order').order('name_fr').then(ok);
export async function saveCategory(c) {
  const row = { name_ar: c.name_ar.trim(), name_fr: c.name_fr.trim(), sort_order: Number(c.sort_order) || 0, is_active: !!c.is_active };
  if (!row.name_ar || !row.name_fr) throw new Error('invalid');
  if (c.id) return supabase.from('categories').update(row).eq('id', c.id).then(ok);
  const slug = `${slugify(row.name_fr) || 'category'}-${Math.random().toString(36).slice(2, 6)}`;
  return supabase.from('categories').insert({ ...row, slug }).then(ok);
}
export const deleteCategory = (id) => supabase.from('categories').delete().eq('id', id).then(ok);

// ---- products ----
export const adminProducts = () =>
  supabase.from('products').select('id, slug, name_ar, name_fr, price, sale_price, is_published, is_featured, is_available, product_variants(is_available), product_images(path, sort_order)')
    .order('created_at', { ascending: false }).then(ok);

export async function adminProduct(id) {
  const p = await supabase.from('products').select('*, product_variants(*), product_images(*)').eq('id', id).single().then(ok);
  p.product_variants.sort((a, b) => a.sort_order - b.sort_order);
  p.product_images.sort((a, b) => a.sort_order - b.sort_order);
  return p;
}

export const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Saves product, variants and images. These are separate requests (not one DB
// transaction): if one step fails the earlier steps stay saved and the error is shown.
export async function saveProduct({ product, variants, removedVariantIds, images, removedImages }) {
  const row = {
    category_id: product.category_id || null,
    name_ar: product.name_ar.trim(), name_fr: product.name_fr.trim(),
    description_ar: product.description_ar || '', description_fr: product.description_fr || '',
    price: Number(product.price),
    sale_price: product.sale_price === '' || product.sale_price == null ? null : Number(product.sale_price),
    is_published: !!product.is_published, is_featured: !!product.is_featured, is_available: !!product.is_available,
  };
  let id = product.id;
  if (id) await supabase.from('products').update(row).eq('id', id).then(ok);
  else {
    const slug = `${slugify(row.name_fr) || 'product'}-${Math.random().toString(36).slice(2, 7)}`;
    id = (await supabase.from('products').insert({ ...row, slug }).select('id').single().then(ok)).id;
  }

  if (removedVariantIds.length) await supabase.from('product_variants').delete().in('id', removedVariantIds).then(ok);
  for (const [i, v] of variants.entries()) {
    const vr = {
      product_id: id, label_ar: v.label_ar.trim(), label_fr: v.label_fr.trim(),
      color: v.color || null, size: v.size || null, capacity: v.capacity || null,
      is_available: !!v.is_available, sort_order: i,
    };
    if (v.id) await supabase.from('product_variants').update(vr).eq('id', v.id).then(ok);
    else await supabase.from('product_variants').insert(vr).then(ok);
  }

  if (removedImages.length) {
    await supabase.storage.from(BUCKET).remove(removedImages.map((r) => r.path));
    await supabase.from('product_images').delete().in('id', removedImages.map((r) => r.id)).then(ok);
  }
  for (const [i, im] of images.entries()) {
    if (im.id) { await supabase.from('product_images').update({ sort_order: i }).eq('id', im.id).then(ok); continue; }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[im.file.type];
    const path = `${id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(BUCKET).upload(path, im.file, { contentType: im.file.type, cacheControl: '31536000' });
    if (up.error) throw up.error;
    await supabase.from('product_images').insert({ product_id: id, path, alt: row.name_fr, sort_order: i }).then(ok);
  }
  return id;
}

export async function deleteProduct(id) {
  const imgs = await supabase.from('product_images').select('path').eq('product_id', id).then(ok);
  if (imgs.length) await supabase.storage.from(BUCKET).remove(imgs.map((i) => i.path));
  return supabase.from('products').delete().eq('id', id).then(ok);
}

// ---- orders ----
export const adminOrders = (status) => {
  let q = supabase.from('orders').select('id, order_number, customer_name, phone, city, status, total, created_at').order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  return q.then(ok);
};
export const adminOrder = (id) => supabase.from('orders').select('*, order_items(*)').eq('id', id).single().then(ok);
export const setOrderStatus = (id, status) => supabase.rpc('set_order_status', { p_order_id: id, p_status: status }).then(ok);

// ---- shipping ----
export const adminShipping = () => supabase.from('shipping_rates').select('*').order('is_default', { ascending: false }).order('city').then(ok);
export async function saveShipping(r) {
  const fee = Number(r.fee);
  if (!(fee >= 0)) throw new Error('invalid');
  if (r.id) return supabase.from('shipping_rates').update({ fee, is_active: !!r.is_active, ...(r.is_default ? {} : { city: r.city.trim() }) }).eq('id', r.id).then(ok);
  if (!r.city?.trim()) throw new Error('invalid');
  return supabase.from('shipping_rates').insert({ city: r.city.trim(), fee, is_active: true }).then(ok);
}
export const deleteShipping = (id) => supabase.from('shipping_rates').delete().eq('id', id).eq('is_default', false).then(ok);
