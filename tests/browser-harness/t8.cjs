const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const widths = [320, 375, 430, 768, 1024, 1440];
  const routes = ['/', '/products', '/products?category=mode', '/products/produit-1', '/cart', '/checkout', '/favorites', '/track', '/delivery', '/contact', '/order-success', '/nope', '/admin/banners', '/admin/banners#new'];
  const bad = []; let n = 0;
  for (const theme of ['dark', 'light']) for (const lang of ['ar', 'fr']) for (const w of widths) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
    await ctx.addInitScript(([l, t]) => { localStorage.setItem('stoph.lang', l); localStorage.setItem('stoph.theme', t); localStorage.setItem('mock.session', JSON.stringify({ access_token: 'mock', user: { id: 'u1' } })); localStorage.setItem('stoph.cart.v1', JSON.stringify([{ productId: '00000000-0000-0000-0000-000000000001', variantId: null, qty: 2, price: 119.99, slug: 'produit-1', nameAr: 'منتج', nameFr: 'Produit exemple', image: null, variantLabel: null }])); }, [lang, theme]);
    const page = await ctx.newPage();
    for (const r of routes) {
      await page.goto('http://localhost:4173' + r.replace('#new', '')); await page.waitForTimeout(350);
      if (r.endsWith('#new')) { await page.click('button.btn-primary').catch(() => {}); await page.waitForTimeout(200); }
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth; const off = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          if (r.right > vw + 1 || r.left < -1) { let p = el.parentElement, scroller = false; while (p) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') && p !== document.body && p !== document.documentElement) { scroller = true; break; } p = p.parentElement; } if (!scroller) off.push(el.tagName + '.' + String(el.className).slice(0, 30) + ` [${Math.round(r.left)},${Math.round(r.right)}]`); }
        }
        return { over: document.documentElement.scrollWidth > vw, off: off.slice(0, 3) };
      });
      n++; if (m.over || m.off.length) bad.push(`${theme}/${lang}/${w} ${r}: scrollOverflow=${m.over} offenders=${m.off.join(' ; ')}`);
    }
    await ctx.close();
  }
  console.log(`checked ${n} page/viewport/lang/theme combinations`); console.log(bad.length ? bad.join('\n') : 'NO horizontal overflow, no off-screen elements'); await b.close();
})();
