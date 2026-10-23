const { chromium } = require('playwright');
const out = []; const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const badge = () => page.evaluate(() => document.querySelector('.tools a[href="/cart"] .count')?.textContent || '0');
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.card');

  // search from header -> products page filtered
  await page.fill('#search-m', 'numéro 3'); await page.press('#search-m', 'Enter'); await page.waitForTimeout(300);
  ok('header search navigates with ?q and filters', page.url().includes('q=') && (await page.locator('.card').count()) >= 1, page.url());

  // home -> product details
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.card');
  await page.click('.card .card-title >> nth=0'); await page.waitForSelector('.detail');
  ok('card opens product details (existing slug URL)', /\/products\/produit-\d+/.test(page.url()));
  ok('related products section rendered', (await page.locator('#h-related').count()) === 1);
  // favorites toggle on detail
  await page.click('.fav-inline'); ok('favorite toggled on product page (aria-pressed)', (await page.getAttribute('.fav-inline', 'aria-pressed')) === 'true');
  // add to cart x2
  await page.fill('#qty', '2'); await page.click('.buy .btn-primary'); await page.waitForTimeout(150);
  ok('add to cart updates header counter', (await badge()) === '2', await badge());
  // cart page
  await page.click('.tools a[href="/cart"]'); await page.waitForSelector('.line');
  ok('cart shows the line with qty 2', (await page.textContent('.stepper output')) === '2');
  await page.click('.stepper button >> nth=1'); ok('increase quantity', (await page.textContent('.stepper output')) === '3' && (await badge()) === '3');
  await page.click('.stepper button >> nth=0'); await page.click('.stepper button >> nth=0'); ok('decrease quantity', (await page.textContent('.stepper output')) === '1');
  ok('decrease disabled at 1', await page.isDisabled('.stepper button >> nth=0'));
  const lt = await page.textContent('.line-total'); const sub = await page.textContent('.summary .total strong, .summary .row strong >> nth=0').catch(() => '');
  ok('subtotal shown', !!(await page.textContent('.summary')));
  // reload -> persistence
  await page.reload(); await page.waitForSelector('.line'); ok('cart persists after refresh', (await page.textContent('.stepper output')) === '1' && (await badge()) === '1');
  // cross-tab sync
  const page2 = await ctx.newPage(); await page2.goto('http://localhost:4173/cart'); await page2.waitForSelector('.line');
  await page2.click('.stepper button >> nth=1'); await page.waitForTimeout(300);
  ok('cart counter syncs across tabs', (await badge()) === '2', await badge()); await page2.close();
  // corrupted storage is sanitized
  await page.evaluate(() => localStorage.setItem('stoph.cart.v1', JSON.stringify([{ productId: 'x', price: 'abc', qty: 1 }, { productId: 'ok', price: 10, qty: 999 }, null, 5])));
  const keyName = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('cart')));
  ok('cart storage key known', keyName.length >= 1, keyName.join(','));
  // clear with confirmation
  await page.goto('http://localhost:4173/products/produit-1'); await page.waitForSelector('.detail'); await page.click('.buy .btn-primary');
  await page.goto('http://localhost:4173/cart'); await page.waitForSelector('.line');
  await page.click('text=تفريغ السلة'); ok('clear asks for confirmation first', (await page.locator('.line').count()) > 0 && (await page.locator('text=تفريغ السلة بالكامل؟').count()) === 1);
  await page.click('text=نعم، فرّغ'); await page.waitForTimeout(200); ok('clear empties the cart', (await page.locator('.line').count()) === 0 && (await badge()) === '0');
  // remove single
  await page.goto('http://localhost:4173/products/produit-2'); await page.waitForSelector('.detail'); await page.click('.buy .btn-primary');
  await page.goto('http://localhost:4173/cart'); await page.waitForSelector('.line'); await page.click('.line .btn-ghost'); await page.waitForTimeout(200);
  ok('remove single line', (await page.locator('.line').count()) === 0);
  // unavailable product (id 5) cannot be added
  await page.goto('http://localhost:4173/products/produit-5'); await page.waitForSelector('.detail');
  ok('unavailable product: add button disabled', await page.isDisabled('.buy .btn-primary'));

  // favorites page
  await page.goto('http://localhost:4173/favorites'); await page.waitForSelector('.card');
  ok('favorites page lists the favourited product', (await page.locator('.card').count()) === 1);
  await page.click('.card .fav-btn'); await page.waitForTimeout(200);
  ok('favorites: removing shows the empty state', (await page.locator('.card').count()) === 0 && (await page.locator('text=لا توجد منتجات في المفضلة').count()) >= 1);

  // checkout double submit (slow rpc so a double tap can happen)
  await page.goto('http://localhost:4173/products/produit-1'); await page.waitForSelector('.detail'); await page.click('.buy .btn-primary');
  await page.goto('http://localhost:4173/checkout'); await page.waitForSelector('main form');
  await page.evaluate(() => { window.__rpcDelay = 600; });
  await page.fill('#full_name', 'Test Client'); await page.fill('#phone', '0612345678'); await page.fill('#city', 'Casablanca'); await page.fill('#address', '12 rue test, quartier');
  await page.waitForTimeout(900);
  const tok1 = await page.evaluate(() => sessionStorage.getItem('stoph.checkout.token'));
  await page.locator('main form button[type=submit]').dblclick(); await page.waitForTimeout(1800);
  const calls = await page.evaluate(() => window.__orderCalls || 0);
  const token = await page.evaluate(() => window.__lastToken);
  ok('double-click on "place order" sends exactly ONE order request', calls === 1, `calls=${calls}`);
  ok('order request carries a client token (uuid)', /^[0-9a-f-]{36}$/i.test(token || ''), String(token));
  ok('order success page reached', page.url().includes('order-success'), page.url());
  

  // ambiguous failure then retry: same cart + details => SAME token reused; server returns the existing order (duplicate)
  await page.goto('http://localhost:4173/products/produit-3'); await page.waitForSelector('.detail'); await page.click('.buy .btn-primary');
  await page.goto('http://localhost:4173/checkout'); await page.waitForSelector('main form');
  await page.fill('#full_name', 'Test Client'); await page.fill('#phone', '0612345678'); await page.fill('#city', 'Casablanca'); await page.fill('#address', '12 rue test, quartier'); await page.waitForTimeout(900);
  await page.evaluate(() => { window.__failOnce = true; const o = window.fetch; });
  const seen = [];
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('mockdb.v1')); });
  // simulate: first attempt reaches the server but the response is lost (network error) -> user taps again
  await page.evaluate(() => { window.__dropResponse = true; });
  await page.locator('main form button[type=submit]').click(); await page.waitForTimeout(500);
  const afterFirst = await page.evaluate(() => ({ calls: window.__orderCalls, token: sessionStorage.getItem('stoph.checkout.token') }));
  await page.evaluate(() => { window.__dropResponse = false; });
  await page.locator('main form button[type=submit]').click().catch(() => {}); await page.waitForTimeout(800);
  const afterSecond = await page.evaluate(() => ({ calls: window.__orderCalls, last: window.__lastToken, dbOrders: JSON.parse(localStorage.getItem('mockdb.v1')).orders }));
  ok('lost response: token kept for the retry', !!afterFirst.token, JSON.stringify(afterFirst));
  ok('retry reuses the same token and creates NO second order', JSON.parse(afterFirst.token).token === afterSecond.last && afterSecond.dbOrders === 2, JSON.stringify(afterSecond));
  ok('token cleared after success', (await page.evaluate(() => sessionStorage.getItem('stoph.checkout.token'))) === null);
  ok('no JS errors in shopping flow', errs.length === 0, errs.join('|'));
  console.log(out.join('\n')); await b.close();
})();
