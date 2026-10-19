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
    sale_starts_at: product.sale_starts_at ? new Date(product.sale_starts_at).toISOString() : null,
    sale_ends_at: product.sale_ends_at ? new Date(product.sale_ends_at).toISOString() : null,
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
// filters: { number, status, phone, city, from, to } (dates are yyyy-mm-dd, Casablanca day boundaries)
const cleanLike = (v) => String(v).replace(/[%,()*\\]/g, ' ').trim().slice(0, 40);
export function adminOrders(f = {}) {
  let q = supabase.from('orders')
    .select('id, order_number, customer_name, phone, city, status, total, created_at, tracking_code')
    .order('created_at', { ascending: false }).limit(200);
  if (f.status) q = q.eq('status', f.status);
  if (f.number && /^\d{1,12}$/.test(String(f.number).trim())) q = q.eq('order_number', Number(f.number));
  if (f.phone) { const d = String(f.phone).replace(/\D/g, ''); if (d) q = q.ilike('phone', `%${d.replace(/^212/, '').replace(/^0/, '')}%`); }
  if (f.city) q = q.ilike('city', `%${cleanLike(f.city)}%`);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+01:00`);
  if (f.to) q = q.lt('created_at', new Date(new Date(`${f.to}T00:00:00+01:00`).getTime() + 86400000).toISOString());
  return q.then(ok);
}
export const adminOrder = (id) => supabase.from('orders').select('*, order_items(*)').eq('id', id).single().then(ok);
export const orderHistory = (id) => supabase.from('order_status_history').select('*').eq('order_id', id).order('created_at').order('id').then(ok);
export const setOrderStatus = (id, status, note) =>
  supabase.rpc('set_order_status', { p_order_id: id, p_status: status, p_note: note || null }).then(ok);
export const newOrdersFeed = (since) => supabase.rpc('admin_new_orders', { p_since: since }).then(ok);

// ---- customers ----
export const adminCustomers = (search) => supabase.rpc('admin_customers', { p_search: search || null, p_limit: 100 }).then(ok);
export const adminCustomer = (id) => supabase.from('customers').select('*').eq('id', id).single().then(ok);
export const sharedPhoneCustomers = (phone, exceptId) => supabase.from('customers').select('id, full_name').eq('phone', phone).neq('id', exceptId).then(ok);
export const customerOrders = (id) =>
  supabase.from('orders').select('id, order_number, status, total, city, created_at').eq('customer_id', id).order('created_at', { ascending: false }).then(ok);
export const updateCustomer = (id, c) =>
  supabase.from('customers').update({ full_name: c.full_name.trim(), staff_notes: c.staff_notes?.trim() || null }).eq('id', id).then(ok);

// ---- coupons ----
export const adminCoupons = () => supabase.from('coupons').select('*').order('created_at', { ascending: false }).then(ok);
export function saveCoupon(c) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const row = {
    code: String(c.code).trim().toUpperCase(), description: c.description?.trim() || null,
    discount_type: c.discount_type, value: Number(c.value),
    max_discount: num(c.max_discount), min_order: Number(c.min_order) || 0,
    starts_at: c.starts_at ? new Date(c.starts_at).toISOString() : null,
    ends_at: c.ends_at ? new Date(c.ends_at).toISOString() : null,
    max_uses: num(c.max_uses), one_per_phone: !!c.one_per_phone, is_active: !!c.is_active,
  };
  return c.id ? supabase.from('coupons').update(row).eq('id', c.id).then(ok) : supabase.from('coupons').insert(row).then(ok);
}
export const deleteCoupon = (id) => supabase.from('coupons').delete().eq('id', id).then(ok);

// ---- reports / audit ----
export const adminReport = (from, to) => supabase.rpc('admin_report', { p_from: from, p_to: to }).then(ok);
export const auditLogs = () => supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200).then(ok);

// ---- staff & roles (all writes go through server functions that enforce the rules) ----
export const listStaff = () => supabase.rpc('list_staff').then(ok);
export const listRoles = async () => {
  const [roles, perms, links] = await Promise.all([
    supabase.from('roles').select('*').order('key').then(ok),
    supabase.from('permissions').select('*').order('key').then(ok),
    supabase.from('role_permissions').select('*').then(ok),
  ]);
  return { roles, perms, links };
};
export const registerStaff = (email, fullName, roleIds) =>
  supabase.rpc('register_staff_by_email', { p_email: email.trim(), p_full_name: fullName || '', p_role_ids: roleIds }).then(ok);
export const setStaffRoles = (userId, roleIds) => supabase.rpc('set_staff_roles', { p_user: userId, p_role_ids: roleIds }).then(ok);
export const setStaffActive = (userId, active) => supabase.rpc('set_staff_active', { p_user: userId, p_active: active }).then(ok);
export const createRole = (key, name) => supabase.rpc('create_role', { p_key: key, p_name: name }).then(ok);
export const setRolePermissions = (roleId, keys) => supabase.rpc('set_role_permissions', { p_role_id: roleId, p_keys: keys }).then(ok);
// Optional: requires the invite-staff Edge Function to be deployed (see README).
export const inviteStaff = async (email, fullName, roleIds) => {
  const { data, error } = await supabase.functions.invoke('invite-staff', {
    body: { email, full_name: fullName, role_ids: roleIds, redirect_to: `${window.location.origin}/admin` },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
};
export const updatePassword = (password) => supabase.auth.updateUser({ password }).then(ok);

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
export const isOwner = () => supabase.rpc('is_owner').then(ok);
