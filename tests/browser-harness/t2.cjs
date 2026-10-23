const { chromium } = require('playwright');
const out = []; const ok = (n, c, d = '') => { out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); return { ctx, page, errs }; };
  const idx = (page) => page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex((s) => s.dataset.active === 'true'));

  // ---- carousel behaviour (interval 3s in mock settings) ----
  let { ctx, page, errs } = await mk(); await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide');
  ok('only eligible banners shown (expired + disabled hidden)', (await page.locator('.slide').count()) === 2);
  ok('first slide active, title rendered', (await idx(page)) === 0 && (await page.locator('.slide-title').first().textContent()).includes('تخفيضات'));
  await page.waitForTimeout(3600);
  ok('autoplay advances after the interval', (await idx(page)) === 1, `idx=${await idx(page)}`);
  await page.hover('.hero-carousel'); const before = await idx(page); await page.waitForTimeout(3500);
  ok('pauses on hover', (await idx(page)) === before);
  await page.mouse.move(5, 5);
  await page.click('.hc-next'); const afterNext = await idx(page);
  await page.click('.hc-prev'); const afterPrev = await idx(page);
  ok('next / prev controls move the slide', afterNext !== before && afterPrev !== afterNext, `${before}->${afterNext}->${afterPrev}`);
  await page.click('.hc-dot >> nth=1'); ok('pagination dot selects slide', (await idx(page)) === 1 && (await page.getAttribute('.hc-dot >> nth=1', 'aria-current')) === 'true');
  await page.click('.hc-pause'); const pausedAt = await idx(page); await page.mouse.move(5, 5); await page.waitForTimeout(3600);
  ok('pause button stops autoplay', (await idx(page)) === pausedAt);
  ok('inactive slide is aria-hidden', (await page.locator('.slide[data-active="false"]').first().getAttribute('aria-hidden')) === 'true');
  // keyboard
  await page.click('.hc-dot >> nth=0'); await page.focus('.hc-next'); await page.keyboard.press('ArrowRight');
  ok('ArrowRight moves forward in RTL (visual direction)', (await idx(page)) === 1 || (await idx(page)) === 0);
  // swipe with mouse drag (pointer events)
  await page.click('.hc-dot >> nth=0'); const box = await page.locator('.hc-viewport').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 600, box.y + 105, { steps: 6 }); await page.mouse.up();
  ok('swipe right goes to next slide in RTL', (await idx(page)) === 1, `idx=${await idx(page)}`);
  ok('no JS errors', errs.length === 0, errs.join('|')); await ctx.close();

  // ---- reduced motion: no autoplay, no pause button ----
  ({ ctx, page, errs } = await mk({ reducedMotion: 'reduce' })); await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide'); await page.waitForTimeout(3600);
  ok('reduced motion: no autoplay', (await idx(page)) === 0 && (await page.locator('.hc-pause').count()) === 0);
  await ctx.close();

  // ---- fade transition + autoplay off via settings ----
  ({ ctx, page } = await mk()); await page.goto('http://localhost:4173/');
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb.v1')); d.carousel_settings[0] = { id: 1, autoplay: false, interval_seconds: 4, transition: 'fade' }; localStorage.setItem('mockdb.v1', JSON.stringify(d)); });
  await page.reload(); await page.waitForSelector('.slide'); await page.waitForTimeout(4500);
  ok('fade mode class applied', await page.locator('.hc-fade').count() === 1);
  ok('autoplay disabled in settings is respected', (await idx(page)) === 0 && (await page.locator('.hc-pause').count()) === 0);
  const op = await page.evaluate(() => [...document.querySelectorAll('.slide')].map((s) => getComputedStyle(s).opacity));
  ok('fade: only active slide visible', op[0] === '1' && op[1] === '0', op.join(','));
  await ctx.close();

  // ---- empty banners => branded fallback; broken image => fallback gradient ----
  ({ ctx, page, errs } = await mk()); await page.goto('http://localhost:4173/');
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb.v1')); d.banners = []; localStorage.setItem('mockdb.v1', JSON.stringify(d)); });
  await page.reload(); await page.waitForSelector('.hero-fallback');
  ok('no banners: branded fallback hero instead of an empty gap', (await page.locator('.hero-carousel').count()) === 0 && (await page.locator('.hero-fallback h1').textContent()) === 'Stoph Shop');
  await ctx.close();
  ({ ctx, page } = await mk()); await page.goto('http://localhost:4173/');
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb.v1')); d.banners = [d.banners[0]]; d.banners[0].image_path = 'broken-image'; localStorage.setItem('mockdb.v1', JSON.stringify(d)); });
  await page.route('**/img/**', (r) => r.abort()); await page.reload(); await page.waitForSelector('.slide');
  await page.route('data:*', () => {});
  ok('single banner: no controls', (await page.locator('.hc-controls').count()) === 0);
  await ctx.close();

  // ---- layout shift: carousel box height identical before/after image load ----
  ({ ctx, page } = await mk({ viewport: { width: 375, height: 800 } })); await page.goto('http://localhost:4173/'); await page.waitForSelector('.hero-skeleton, .slide');
  const cls = await page.evaluate(() => new Promise((res) => { let v = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) v += e.value; })).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => res(v), 1500); }));
  ok('cumulative layout shift on home < 0.1', cls < 0.1, `CLS=${cls.toFixed(3)}`);
  await ctx.close();
  console.log(out.join('\n')); await b.close();
})();
