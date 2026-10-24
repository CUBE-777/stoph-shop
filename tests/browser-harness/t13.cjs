const { chromium } = require('playwright');
const allowed = ['#111111','#5C3828','#D6B878','#E8D5A3','#F5F1E8','#A8A29E','#3F291F','#2F211A','#4A3F2E','#3B3124','#1E1712','#2A1B14','#FBF8F1','#EBE3D1','#D6C9AE','#5E5650','#E8998A','#9A3B2B','#FFFFFF'];
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const allowedRGB = allowed.map(rgb);
(async () => {
  const b = await chromium.launch(); const routes = ['/', '/products', '/products/produit-1', '/cart', '/checkout', '/favorites', '/track', '/delivery', '/contact', '/admin', '/admin/banners'];
  const bad = new Map(); let checked = 0;
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([t]) => { localStorage.setItem('stoph.theme', t); localStorage.setItem('mock.session', JSON.stringify({ access_token: 'mock', user: { id: 'u1' } })); localStorage.setItem('stoph.cart.v1', JSON.stringify([{ productId: '00000000-0000-0000-0000-000000000001', variantId: null, qty: 2, price: 119.99, slug: 'produit-1', name_ar: 'منتج', name_fr: 'Produit', image: null, variantLabel: null }])); }, [theme]);
    const page = await ctx.newPage();
    for (const r of routes) {
      await page.goto('http://localhost:4173' + r); await page.waitForTimeout(450);
      const found = await page.evaluate((allowedRGB) => {
        const out = []; const near = (c) => allowedRGB.some((a) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) <= 6);
        const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('.mfa-qr') || el.tagName === 'IMG' || el.tagName === 'svg' && false) continue;
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); if (!r.width || !r.height || cs.visibility === 'hidden') continue;
          const props = [['color', cs.color], ['background-color', cs.backgroundColor], ['border-top-color', cs.borderTopWidth !== '0px' ? cs.borderTopColor : null], ['outline-color', cs.outlineStyle !== 'none' ? cs.outlineColor : null]];
          for (const [p, v] of props) { if (!v) continue; const x = parse(v); if (!x || x.a === 0) continue; if (!near(x.c)) out.push(`${p}:${v}  <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}">`); }
        }
        return out;
      }, allowedRGB);
      checked++; for (const f of found) bad.set(f, (bad.get(f) || 0) + 1);
    }
    await ctx.close();
  }
  console.log(`scanned ${checked} page/theme combinations`);
  console.log(bad.size ? [...bad.entries()].slice(0, 25).map(([k, n]) => `${n}x ${k}`).join('\n') : 'every rendered text/background/border/outline colour is inside the STOPH palette (or its documented tints)');
  await b.close();
})();
