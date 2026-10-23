// In-memory Supabase stand-in for the verification harness ONLY. It cannot prove RLS/SQL; it lets the real UI run.
const KEY = 'mockdb.v1';
const svg = (c1, c2, label) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="1600" height="600" fill="url(#g)"/><text x="800" y="320" font-size="90" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`)}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2).padEnd(32, '0').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'));
function seed() {
  const cats = ['Mode', 'Maison', 'Beauté', 'Accessoires'].map((n, i) => ({ id: `c${i}`, slug: n.toLowerCase().replace('é', 'e'), name_fr: n, name_ar: ['أزياء', 'المنزل', 'الجمال', 'إكسسوارات'][i], sort_order: i }));
  const now = Date.now();
  const products = Array.from({ length: 14 }, (_, i) => ({
    id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`, slug: `produit-${i}`, name_fr: `Produit exemple numéro ${i} avec un nom assez long pour tester`, name_ar: `منتج تجريبي رقم ${i} باسم طويل نسبياً لاختبار القص`,
    description_fr: 'Description', description_ar: 'وصف', price: 100 + i * 19.99, sale_price: i % 4 === 0 ? 79.9 + i : null, sale_starts_at: null, sale_ends_at: null,
    is_available: i !== 5, is_featured: i % 3 === 0, is_published: true, category_id: cats[i % 4].id, created_at: new Date(now - i * 3600e3).toISOString(),
  }));
  const images = products.map((p, i) => ({ id: `i${i}`, product_id: p.id, path: `p${i}`, alt: '', sort_order: 0 }));
  const banners = [
    { id: 'b1', title_ar: 'تخفيضات الخريف', title_fr: 'Soldes d’automne', subtitle_ar: 'عروض حتى نفاد الكمية', subtitle_fr: 'Offres à durée limitée', button_ar: 'تسوّق الآن', button_fr: 'J’en profite', link_type: 'category', category_id: 'c0', image_path: 'ban1', mobile_image_path: 'ban1m', is_active: true, sort_order: 10, starts_at: null, ends_at: null, created_at: '2026-01-01' },
    { id: 'b2', title_ar: 'وصل حديثاً', title_fr: 'Nouveautés', subtitle_ar: null, subtitle_fr: null, button_ar: null, button_fr: null, link_type: 'page', page_path: '/products', image_path: 'ban2', mobile_image_path: null, is_active: true, sort_order: 20, starts_at: null, ends_at: null, created_at: '2026-01-02' },
    { id: 'b3', title_ar: 'منتهية', title_fr: 'Expirée', link_type: 'none', image_path: 'ban3', is_active: true, sort_order: 30, ends_at: '2020-01-01T00:00:00Z', starts_at: null, created_at: '2026-01-03' },
    { id: 'b4', title_ar: 'معطلة', title_fr: 'Désactivée', link_type: 'none', image_path: 'ban3', is_active: false, sort_order: 40, starts_at: null, ends_at: null, created_at: '2026-01-04' },
  ];
  return { categories: cats, products, product_images: images, product_variants: [], banners, carousel_settings: [{ id: 1, autoplay: true, interval_seconds: 3, transition: 'slide' }],
    shipping_rates: [{ id: 's0', city: null, fee: 40, is_default: true, is_active: true }, { id: 's1', city: 'Casablanca', fee: 25, is_default: false, is_active: true }], best: products.slice(2, 8).map((p) => p.id), tokens: {}, orders: 0 };
}
const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch {} const d = seed(); localStorage.setItem(KEY, JSON.stringify(d)); return d; };
const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
const auth = { session: (() => { try { return JSON.parse(localStorage.getItem('mock.session')); } catch { return null; } })(), subs: [] };
const eligible = (b) => b.is_active && (!b.starts_at || new Date(b.starts_at) <= new Date()) && (!b.ends_at || new Date(b.ends_at) > new Date());
const PERMS = () => JSON.parse(localStorage.getItem('mock.perms') || '["orders.view","banners.manage","products.view"]');

class Q {
  constructor(t) { this.t = t; this.f = []; this.mode = 'select'; this.ord = []; }
  select() { this.sel = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; } neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, v) { this.f.push((r) => v.includes(r[c])); return this; } gte(c, v) { this.f.push((r) => r[c] >= v); return this; } lte(c, v) { this.f.push((r) => r[c] <= v); return this; }
  not(c, op, v) { if (op === 'is' && v === null) this.f.push((r) => r[c] != null); return this; }
  or(s) { const terms = s.split(',').map((x) => x.match(/^(\w+)\.ilike\.%(.*)%$/)).filter(Boolean); this.f.push((r) => terms.some((m) => String(r[m[1]] || '').toLowerCase().includes(m[2].toLowerCase()))); return this; }
  order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; } range(a, b) { this.rg = [a, b]; return this; } limit(n) { this.rg = [0, n - 1]; return this; }
  maybeSingle() { this.one = 'maybe'; return this; } single() { this.one = 'single'; return this; }
  insert(row) { this.mode = 'insert'; this.row = row; return this; } update(row) { this.mode = 'update'; this.row = row; return this; } delete() { this.mode = 'delete'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const db = load(); const tbl = db[this.t] || (db[this.t] = []);
    const denied = this.mode !== 'select' && !(auth.session && PERMS().includes('banners.manage') && ['banners', 'carousel_settings'].includes(this.t));
    if (denied) return { data: null, error: { message: 'new row violates row-level security policy' } };
    let rows = tbl.filter((r) => this.f.every((f) => f(r)));
    if (this.t === 'banners' && this.mode === 'select' && !(auth.session && PERMS().includes('banners.manage'))) rows = rows.filter(eligible);
    if (this.mode === 'insert') { const r = { id: uid(), created_at: new Date().toISOString(), ...this.row }; tbl.push(r); save(db); rows = [r]; }
    else if (this.mode === 'update') { rows.forEach((r) => Object.assign(r, this.row)); save(db); }
    else if (this.mode === 'delete') { db[this.t] = tbl.filter((r) => !rows.includes(r)); save(db); rows = []; }
    for (const [c, asc] of [...this.ord].reverse()) rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
    if (this.rg) rows = rows.slice(this.rg[0], this.rg[1] + 1);
    rows = rows.map((r) => {
      const o = { ...r };
      if (this.t === 'products') { o.product_images = db.product_images.filter((i) => i.product_id === r.id); o.product_variants = db.product_variants.filter((v) => v.product_id === r.id); o.categories = db.categories.find((c) => c.id === r.category_id) || null; }
      if (this.t === 'banners') { o.products = db.products.find((p) => p.id === r.product_id) || null; o.categories = db.categories.find((c) => c.id === r.category_id) || null; }
      return o;
    });
    if (this.one) { if (!rows[0] && this.one === 'single') return { data: null, error: { message: 'no rows' } }; return { data: rows[0] || null, error: null }; }
    return { data: rows, error: null };
  }
}
const rpcs = {
  best_selling_products: (db) => db.best.map((product_id) => ({ product_id })),
  my_permissions: () => PERMS(), is_owner: () => true, mfa_status: () => ({ enforced: false, required: false, is_staff: true, aal: 'aal1', satisfied: true }),
  admin_dashboard: () => ({ orders_today: 2, pending: 1, by_status: { new: 1, delivered: 3 }, delivered_revenue: 1200, open_returns: 0, published_products: 14, unavailable_products: 1 }),
  admin_new_orders: () => ({ count: 0, now: new Date().toISOString() }),
  quote_order: (db, a) => { const sub = a.p_items.reduce((s, i) => { const p = db.products.find((x) => x.id === i.product_id); return s + Math.round((p.sale_price ?? p.price) * 100) * i.quantity; }, 0) / 100; const city = db.shipping_rates.find((r) => r.city && r.city.toLowerCase() === (a.p_city || '').toLowerCase()); const ship = city ? city.fee : 40; return { subtotal: sub, discount_total: 0, coupon_discount: 0, shipping_fee: ship, total: sub + ship }; },
  create_order: (db, a) => {
    window.__orderCalls = (window.__orderCalls || 0) + 1; window.__lastToken = a.p_customer.client_token;
    const tok = a.p_customer.client_token; if (tok && db.tokens[tok]) return { ...db.tokens[tok], duplicate: true };
    db.orders += 1; const res = { order_number: 1000 + db.orders, tracking_code: 'abcdef0123', total: 123.45 }; if (tok) db.tokens[tok] = res; save(db); return res;
  },
};
const mockSession = () => ({ access_token: 'mock', user: { id: 'u1', email: 'admin@test.local' } });
export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (n, a) => { const db = load(); if (window.__rpcDelay && n === 'create_order') await new Promise((r) => setTimeout(r, window.__rpcDelay)); const f = rpcs[n]; const data = f ? f(db, a || {}) : null; if (n === 'create_order' && window.__dropResponse) return { data: null, error: { message: 'Failed to fetch' } }; return { data, error: null }; },
    storage: { from: (b) => ({ getPublicUrl: (p) => ({ data: { publicUrl: p.startsWith('ban') ? svg(p === 'ban1' ? '#7a0000' : '#1d3557', p === 'ban1' ? '#fe9201' : '#e10600', p) : `/img/${p}.svg` } }), remove: async () => ({}) }) },
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      onAuthStateChange: (cb) => { auth.subs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => { auth.session = mockSession(); localStorage.setItem('mock.session', JSON.stringify(auth.session)); auth.subs.forEach((c) => c('SIGNED_IN', auth.session)); return { data: { session: auth.session }, error: null }; },
      signOut: async () => { auth.session = null; localStorage.removeItem('mock.session'); auth.subs.forEach((c) => c('SIGNED_OUT', null)); },
      updateUser: async () => ({ data: {}, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }), listFactors: async () => ({ data: { totp: [], all: [] }, error: null }) },
    },
  };
}
