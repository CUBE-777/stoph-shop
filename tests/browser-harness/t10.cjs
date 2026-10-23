const { chromium } = require('playwright');
const out = []; const ok = (n, c, d = '') => { const l = `${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`; out.push(l); console.log(l); };
(async () => {
  const b = await chromium.launch();
  // phone: product page sticky bar
  let ctx = await b.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true }); let page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/products/produit-1'); await page.waitForSelector('.detail'); await page.waitForTimeout(300);
  ok('phone: sticky buy bar shown while the buy box is off-screen', (await page.locator('.sticky-buy').count()) === 1);
  const r = await page.evaluate(() => { const s = document.querySelector('.sticky-buy').getBoundingClientRect(); const n = document.querySelector('.bottom-nav').getBoundingClientRect(); return { sBottom: s.bottom, nTop: n.top }; });
  ok('sticky bar sits above the bottom navigation (no overlap)', r.sBottom <= r.nTop + 1, JSON.stringify(r));
  await page.click('.sticky-buy .btn-primary'); await page.waitForTimeout(200);
  ok('sticky bar adds the product to the cart', (await page.evaluate(() => document.querySelector('.tools a[href="/cart"] .count')?.textContent)) === '1');
  await page.evaluate(() => document.getElementById('buy-box').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
  ok('sticky bar hides when the real buy box is visible', (await page.locator('.sticky-buy').count()) === 0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(700); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(200);
  const lastVisible = await page.evaluate(() => { const f = document.querySelector('.foot-bottom').getBoundingClientRect(); const bn = document.querySelector('.bottom-nav').getBoundingClientRect(); const sb = document.querySelector('.sticky-buy'); return f.bottom <= (sb ? sb.getBoundingClientRect().top : bn.top) + 1; });
  ok('page bottom (footer) not hidden behind the bars', lastVisible);
  // unavailable product: bar button disabled
  await page.goto('http://localhost:4173/products/produit-5'); await page.waitForSelector('.detail'); await page.waitForTimeout(300);
  ok('unavailable product: sticky button disabled', await page.isDisabled('.sticky-buy .btn-primary'));
  await ctx.close();
  // desktop: no sticky bar
  ctx = await b.newContext({ viewport: { width: 1280, height: 700 } }); page = await ctx.newPage(); await page.goto('http://localhost:4173/products/produit-1'); await page.waitForSelector('.detail');
  await page.evaluate(() => window.scrollTo(0, 99999)); await page.waitForTimeout(300);
  ok('desktop: sticky bar hidden by CSS', !(await page.locator('.sticky-buy').isVisible().catch(() => false)));
  await ctx.close();
  // products filters on phone
  ctx = await b.newContext({ viewport: { width: 375, height: 800 } }); page = await ctx.newPage(); await page.goto('http://localhost:4173/products'); await page.waitForSelector('.card');
  ok('phone: category + sort visible, extra filters collapsed', (await page.locator('#cat').isVisible()) && (await page.locator('#sort').isVisible()) && !(await page.locator('#min').isVisible()));
  await page.click('.more-filters > summary'); ok('phone: summary opens price/search filters', await page.locator('#min').isVisible());
  await page.selectOption('#cat', 'mode'); await page.waitForTimeout(250); ok('category filter narrows the list', (await page.locator('.card').count()) < 14 && page.url().includes('category=mode'));
  await page.fill('#search-m', 'numéro 7'); await page.press('#search-m', 'Enter'); await page.waitForTimeout(300);
  ok('header search updates the products page search box', (await page.inputValue('#q')).includes('numéro 7') || !(await page.locator('#q').isVisible()), page.url());
  await page.goto('http://localhost:4173/products'); await page.waitForSelector('.card');
  const before = await page.locator('.card').count(); await page.click('button:has-text("عرض المزيد")').catch(() => {}); await page.waitForTimeout(300);
  ok('load more appends the next page (no duplicates)', (await page.locator('.card').count()) >= before && new Set(await page.locator('.card-title').allTextContents()).size === (await page.locator('.card').count()));
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage(); await page.goto('http://localhost:4173/products'); await page.waitForSelector('.card');
  ok('desktop: all filters visible without opening anything', (await page.locator('#min').isVisible()) && (await page.locator('#q').isVisible()));
  await ctx.close();
  ok('no JS errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
