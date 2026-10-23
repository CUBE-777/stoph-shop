const { chromium } = require('playwright');
const out = []; const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
(async () => {
  const b = await chromium.launch();
  const idx = (page) => page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex((s) => s.dataset.active === 'true'));
  for (const lang of ['ar', 'fr']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
    await ctx.addInitScript((l) => localStorage.setItem('stoph.lang', l), lang);
    const page = await ctx.newPage(); await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide');
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb.v1')); d.carousel_settings[0].autoplay = false; localStorage.setItem('mockdb.v1', JSON.stringify(d)); }); await page.reload(); await page.waitForSelector('.slide');
    const swipe = (dx, dy = 4) => page.evaluate(([dx, dy]) => { const el = document.querySelector('.hc-viewport'); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const ev = (t, X, Y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'touch', clientX: X, clientY: Y, isPrimary: true })); ev('pointerdown', x, y); ev('pointermove', x + dx / 2, y + dy / 2); ev('pointerup', x + dx, y + dy); }, [dx, dy]);
    await swipe(lang === 'ar' ? 120 : -120); ok(`${lang}: touch swipe in reading direction -> next`, (await idx(page)) === 1);
    await swipe(lang === 'ar' ? -120 : 120); ok(`${lang}: swipe back -> previous`, (await idx(page)) === 0);
    await swipe(10); ok(`${lang}: tiny movement ignored`, (await idx(page)) === 0);
    await swipe(120, 150); ok(`${lang}: mostly-vertical gesture (page scroll) ignored`, (await idx(page)) === 0);
    // dragging over a linked slide must not navigate
    await page.mouse.move(150, 300); const path0 = new URL(page.url()).pathname; await swipe(lang === 'ar' ? 120 : -120);
    ok(`${lang}: swipe does not trigger the slide link`, new URL(page.url()).pathname === path0);
    // tap on slide navigates to the category
    await page.click('.slide[data-active="true"] .slide-inner'); await page.waitForTimeout(150);
    ok(`${lang}: tap on slide follows its destination`, page.url().includes('/products') , page.url());
    await ctx.close();
  }
  console.log(out.join('\n')); await b.close();
})();
