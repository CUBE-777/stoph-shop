const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const shot = async (name, w, h, route, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([l, t]) => { localStorage.setItem('stoph.lang', l); localStorage.setItem('stoph.theme', t); localStorage.setItem('mock.session', JSON.stringify({ access_token: 'mock', user: { id: 'u1' } })); localStorage.setItem('stoph.cart.v1', JSON.stringify([{ productId: '00000000-0000-0000-0000-000000000001', variantId: null, qty: 2, price: 119.99, slug: 'produit-1', name_ar: 'منتج تجريبي رقم 1', name_fr: 'Produit exemple 1', image: null, variantLabel: null }])); }, [o.lang || 'ar', o.theme || 'dark']);
    const page = await ctx.newPage(); await page.goto('http://localhost:4173' + route); await page.waitForTimeout(700);
    if (o.click) { await page.click(o.click); await page.waitForTimeout(300); }
    await page.screenshot({ path: `/tmp/harness/shots/${name}.png`, fullPage: !!o.full }); await ctx.close();
  };
  await shot('lux-home-375', 375, 800, '/');
  await shot('lux-home-1280', 1280, 900, '/', { lang: 'fr', full: false });
  await shot('lux-product-375', 375, 800, '/products/produit-1');
  await shot('lux-cart-375', 375, 800, '/cart');
  await shot('lux-home-light-1024', 1024, 800, '/', { theme: 'light', lang: 'fr' });
  await shot('lux-admin-1280', 1280, 900, '/admin/banners');
  await b.close();
})();
