const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const widths = [320, 375, 430, 768, 1024, 1440];
  const results = [];
  for (const lang of ['ar', 'fr']) for (const w of widths) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, hasTouch: w < 800, deviceScaleFactor: 1 });
    await ctx.addInitScript((l) => { try { if (!localStorage.getItem('stoph.lang')) localStorage.setItem('stoph.lang', l); } catch {} }, lang);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('http://localhost:4173/'); await page.waitForSelector('.hero-carousel .slide', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, slides: document.querySelectorAll('.slide').length, dots: document.querySelectorAll('.hc-dot').length, rows: [...document.querySelectorAll('section h2')].map((h) => h.textContent), bottomNav: getComputedStyle(document.querySelector('.bottom-nav')).display, h: document.querySelector('.hc-viewport')?.getBoundingClientRect().height }));
    results.push({ lang, w, overflow: m.sw > m.cw, ...m, errs: errs.slice(0, 3) });
    if (lang === 'ar' || w === 375) await page.screenshot({ path: `/tmp/harness/shots/home-${lang}-${w}.png`, fullPage: false });
    if ((lang === 'ar') && (w === 375 || w === 1440)) await page.screenshot({ path: `/tmp/harness/shots/home-full-${lang}-${w}.png`, fullPage: true });
    await ctx.close();
  }
  console.log(JSON.stringify(results.map((r) => ({ ...r, rows: r.rows.length })), null, 0).replace(/\},/g, '},\n'));
  await b.close();
})();
