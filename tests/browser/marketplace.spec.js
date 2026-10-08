import { test, expect } from '@playwright/test';

test('homepage, sample search and auction preview work without configuration', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Discover rare finds.');
  await expect(page.locator('.home-auction-grid .auction-card')).toHaveCount(4);
  await expect(page.getByText('PREVIEW MODE')).toBeVisible();
  await page.getByRole('link', { name: 'Explore auctions', exact: true }).first().click();
  await page.getByLabel('Search auctions').fill('Alpha');
  await expect(page.locator('.auction-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'View auction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sony Alpha Camera & Lens' })).toBeVisible();
  await expect(page.getByText('Read-only preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place bid' })).toHaveCount(0);
  await expect(page.locator('.auction-result')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('category, sort and empty state controls work', async ({ page }) => {
  await page.goto('/explore?category=Electronics');
  await expect(page.locator('.auction-card')).toHaveCount(2);
  await page.getByLabel('Sort auctions').selectOption('price-low');
  await expect(page.locator('.auction-card h3').first()).toContainText('Sony');
  await page.getByLabel('Search auctions').fill('nothing matches this');
  await expect(page.getByRole('heading', { name: 'No matches this time' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.auction-card')).toHaveCount(6);
  await page.getByLabel('Auction status').selectOption('ended');
  await expect(page.locator('.auction-card')).toHaveCount(0);
});

test('unconfigured auth and protected pages offer setup guidance', async ({ page }) => {
  await page.goto('/login?mode=signup');
  await expect(page.getByLabel('Full name')).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create my account' })).toBeDisabled();
  for (const route of ['/create', '/dashboard']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Connect Supabase to continue' })).toBeVisible();
  }
  await page.goto('/unknown');
  await expect(page.getByRole('heading', { name: 'This find got away' })).toBeVisible();
});

test('mobile menu, image loading and page widths work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/explore', '/auctions/sample-camera', '/login']) {
    await page.goto(route);
    await page.locator('h1').first().waitFor();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Explore Auctions' }).click();
  await expect(page).toHaveURL(/\/explore/);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
});

const origin = 'http://127.0.0.1:5174';
const seller = '10000000-0000-4000-8000-000000000001';
const buyer = '10000000-0000-4000-8000-000000000002';
const auctionId = '10000000-0000-4000-8000-000000000010';
const user = id => ({ id, aud: 'authenticated', role: 'authenticated', email: `${id === seller ? 'seller' : 'buyer'}@example.com`, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: id === seller ? 'Sara Seller' : 'Ben Buyer' }, created_at: new Date().toISOString() });
function session(id) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', exp })).toString('base64url')}.test-signature`;
  return { access_token: token, refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: exp, token_type: 'bearer', user: user(id) };
}
function listing(overrides = {}) {
  return { id: auctionId, seller_id: seller, title: 'Vintage camera', description: 'A working camera with its original lens and case.', category: 'Electronics', image_url: '/images/camera.jpg', starting_price: 500, highest_bid: null, bid_count: 0, end_time: new Date(Date.now() + 3600000).toISOString(), created_at: new Date().toISOString(), seller_name: 'Sara', highest_bidder_id: null, winner_id: null, winner_name: null, ...overrides };
}
async function authenticate(page, id) {
  await page.addInitScript(value => localStorage.setItem('sb-testproject-auth-token', JSON.stringify(value)), session(id));
}
async function mockApi(page, { auction = listing(), signup = false, failure = false } = {}) {
  const state = { auction, bids: [], rpcCalls: [], creates: [], uploaded: false, failure };
  await page.route('https://testproject.supabase.co/**', async route => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const offset = Number(requestUrl.searchParams.get('offset') ?? request.headers().range?.split('-')[0] ?? 0);
    const pageRows = rows => rows.slice(offset, offset + Number(requestUrl.searchParams.get('limit') || 1000));
    const matchingRows = rows => rows.filter(row => [...requestUrl.searchParams].every(([column, filter]) => {
      if (['select', 'order', 'offset', 'limit'].includes(column)) return true;
      if (filter.startsWith('eq.')) return String(row[column]) === filter.slice(3);
      if (filter.startsWith('gt.')) return row[column] > filter.slice(3);
      if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(row[column]));
      throw new Error(`Unhandled test filter: ${column}=${filter}`);
    }));
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path.endsWith('/auth/v1/token')) return json(session(buyer));
    if (path.endsWith('/auth/v1/signup')) return json({ user: user(buyer), session: null });
    if (path.endsWith('/auth/v1/user')) return json(user(buyer));
    if (path.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    if (path.includes('/storage/v1/object/')) { state.uploaded = true; return json({ Key: 'auction-images/photo.jpg' }); }
    if (path.endsWith('/rest/v1/auction_summaries')) {
      const isSingle = request.headers().accept?.includes('vnd.pgrst.object');
      const rows = matchingRows([state.auction]);
      return json(isSingle ? rows[0] || null : pageRows(rows));
    }
    if (path.endsWith('/rest/v1/bid_history') || path.endsWith('/rest/v1/bids')) return json(pageRows(matchingRows(state.bids)));
    if (path.endsWith('/rest/v1/auctions') && request.method() === 'POST') {
      const record = request.postDataJSON(); state.creates.push(record);
      state.auction = { ...state.auction, ...record };
      return json({ id: auctionId }, 201);
    }
    if (path.endsWith('/rest/v1/rpc/place_bid')) {
      const record = request.postDataJSON(); state.rpcCalls.push(record);
      if (state.failure) return json({ code: '22023', message: 'The minimum bid is ₹700. Refresh and try again.' }, 400);
      state.bids = [{ id: 'bid-1', auction_id: auctionId, bidder_id: buyer, bidder_name: 'Ben', amount: record.p_amount, created_at: new Date().toISOString() }];
      state.auction = { ...state.auction, highest_bid: record.p_amount, bid_count: 1, highest_bidder_id: buyer };
      return json(state.bids[0]);
    }
    return json({ message: `Unhandled test request: ${path}` }, 400);
  });
  return state;
}

test('configured login/logout and verification signup show confirmed outcomes', async ({ page }) => {
  await mockApi(page);
  await page.goto(`${origin}/login?redirect=/explore`);
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Password').fill('test-password');
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/explore`);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
  await page.goto(`${origin}/login?mode=signup`);
  await page.getByLabel('Full name').fill('Ben Buyer');
  await page.getByLabel('Email address').fill('new@example.com');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByText('Check your email for a confirmation link.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('buyer bid is confirmed by RPC and a stale bid error never shows success', async ({ page }) => {
  const state = await mockApi(page);
  await authenticate(page, buyer);
  await page.goto(`${origin}/auctions/${auctionId}`);
  await page.getByLabel('Your bid', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(page.getByText('Your bid was placed successfully.')).toBeVisible();
  expect(state.rpcCalls).toEqual([{ p_auction_id: auctionId, p_amount: 500 }]);
  await expect(page.locator('.current-bid-value')).toHaveText('₹500.00');
  await expect(page.locator('.bid-list .bid-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByLabel('Your bid', { exact: true }).fill('550');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at least');
  expect(state.rpcCalls).toHaveLength(1);
  state.failure = true;
  await page.getByLabel('Your bid', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('minimum bid is ₹700');
  await expect(page.getByText('Your bid was placed successfully.')).toHaveCount(0);
});

test('anonymous, seller and expired auction screens prohibit bidding and show the winner', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/auctions/${auctionId}`);
  await expect(page.getByRole('link', { name: 'Sign in to bid' })).toBeVisible();
  await authenticate(page, seller);
  await page.reload();
  await expect(page.getByText('This is your auction.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place bid' })).toHaveCount(0);
  state.auction = listing({ end_time: new Date(Date.now() - 1000).toISOString(), highest_bid: 700, bid_count: 2, highest_bidder_id: buyer, winner_id: buyer, winner_name: 'Ben' });
  await page.reload();
  await expect(page.getByText('Won by Ben', { exact: true })).toBeVisible();
  await expect(page.getByText('Bidding is closed for this auction.')).toBeVisible();
});

test('seller uploads and creates an auction, then sees own dashboard', async ({ page }) => {
  const state = await mockApi(page);
  await authenticate(page, seller);
  await page.goto(`${origin}/create`);
  await page.getByLabel('Item title').fill('Vintage camera');
  await page.getByLabel('Description', { exact: true }).fill('A working camera with its original lens and case.');
  await page.getByLabel('Category', { exact: true }).selectOption('Electronics');
  await page.getByLabel('Starting price').fill('500');
  await page.getByLabel('Auction end date').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByLabel('Item photo').setInputFiles('public/images/camera.jpg');
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page).toHaveURL(`${origin}/auctions/${auctionId}`);
  expect(state.uploaded).toBe(true);
  expect(state.creates[0]).toMatchObject({ seller_id: seller, starting_price: 500, title: 'Vintage camera' });
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
  await expect(page.locator('.stat-card').nth(0).locator('strong')).toHaveText('1');
  await expect(page.locator('.dashboard-table tbody tr')).toHaveCount(1);
});

test('seller forms and populated buyer dashboard fit mobile screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockApi(page);
  await authenticate(page, seller);
  await page.goto(`${origin}/create`);
  await expect(page.getByRole('heading', { name: 'Create an auction' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator('.dashboard-table tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const buyerPage = await page.context().newPage();
  await buyerPage.setViewportSize({ width: 390, height: 844 });
  const buyerState = await mockApi(buyerPage, { auction: listing({ end_time: new Date(Date.now() - 1000).toISOString(), highest_bid: 700, bid_count: 2, highest_bidder_id: buyer, winner_id: buyer, winner_name: 'Ben' }) });
  buyerState.bids = [{ auction_id: auctionId, amount: 700, bidder_id: buyer }];
  await authenticate(buyerPage, buyer);
  await buyerPage.goto(`${origin}/dashboard`);
  await expect(buyerPage.locator('.stat-card').nth(3).locator('strong')).toHaveText('1');
  await expect(buyerPage.locator('.stat-card').nth(0).locator('strong')).toHaveText('0');
  expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await buyerPage.close();
});

test('countdown expiry refreshes and displays the server winner', async ({ page }) => {
  const start = Date.now();
  await page.clock.install({ time: start });
  const state = await mockApi(page, { auction: listing({ end_time: new Date(start + 3000).toISOString(), highest_bid: 700, bid_count: 2, highest_bidder_id: buyer }) });
  await page.goto(`${origin}/auctions/${auctionId}`);
  await expect(page.locator('.current-bid-value')).toBeVisible();
  state.auction = { ...state.auction, winner_id: buyer, winner_name: 'Ben' };
  await page.clock.fastForward(4000);
  await expect(page.getByText('Won by Ben', { exact: true })).toBeVisible();
  await expect(page.getByText('Bidding is closed for this auction.')).toBeVisible();
});
