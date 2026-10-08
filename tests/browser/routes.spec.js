import { test, expect as baseExpect } from '@playwright/test';

test.setTimeout(60000);
const expect = baseExpect.configure({ timeout: 10000 });

const origin = 'http://127.0.0.1:5174';
const auctionId = '10000000-0000-4000-8000-000000000010';
const missingId = '10000000-0000-4000-8000-000000000011';
const buyerId = '10000000-0000-4000-8000-000000000002';
const listing = (overrides = {}) => ({ id: auctionId, seller_id: '10000000-0000-4000-8000-000000000001', title: 'Vintage camera', description: 'A working camera with its original lens.', category: 'Electronics', image_url: '/images/camera.jpg', starting_price: 500, highest_bid: null, bid_count: 0, end_time: new Date(Date.now() + 3600000).toISOString(), created_at: new Date().toISOString(), seller_name: 'Sara', highest_bidder_id: null, winner_id: null, winner_name: null, ...overrides });
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

async function pauseClock(page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  return now + 1000;
}

async function marketplace(page, auction = listing()) {
  const state = { auctions: [auction], requests: [], pending: [], hold: false, failure: false };
  await page.route('https://testproject.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/v1/token')) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: buyerId, role: 'authenticated', exp })).toString('base64url')}.signature`;
      return json(route, { access_token: token, refresh_token: 'test-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user: { id: buyerId, aud: 'authenticated', role: 'authenticated', email: 'buyer@example.com', app_metadata: {}, user_metadata: { full_name: 'Ben Buyer' } } });
    }
    if (!url.pathname.includes('/rest/v1/')) return json(route, {});
    state.requests.push(url);
    if (url.pathname.endsWith('/auction_summaries')) {
      if (state.hold) { state.pending.push(route); return; }
      if (state.failure) return json(route, { message: 'Marketplace temporarily unavailable', code: '42501' }, 400);
      const requestedId = url.searchParams.get('id')?.replace('eq.', '');
      if (requestedId === 'invalid') return json(route, { message: 'invalid input syntax for type uuid', code: '22P02' }, 400);
      let rows = requestedId ? state.auctions.filter(row => row.id === requestedId) : state.auctions;
      const deadline = url.searchParams.get('end_time')?.replace('gt.', '');
      if (deadline) rows = rows.filter(row => row.end_time > deadline);
      const offset = Number(url.searchParams.get('offset') || 0);
      return json(route, rows.slice(offset, offset + Number(url.searchParams.get('limit') || 1000)));
    }
    return json(route, []);
  });
  return state;
}

for (const path of ['/', '/explore']) {
  test(`${path} refreshes bids and listings while retaining data on refresh failure`, async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    const state = await marketplace(page);
    await page.goto(origin + path);
    if (path === '/explore') await page.getByLabel('Search auctions').waitFor();
    await expect(page.locator('.auction-card')).toHaveCount(1);
    await pauseClock(page);
    state.auctions = [listing({ highest_bid: 900, bid_count: 2 }), listing({ id: missingId, title: 'New headphones' })];
    state.hold = true;
    await page.clock.fastForward(15000);
    await expect.poll(() => state.pending.length).toBe(1);
    await page.clock.fastForward(30000);
    expect(state.pending).toHaveLength(1);
    state.hold = false;
    await json(state.pending[0], state.auctions);
    await expect(page.locator('.auction-card')).toHaveCount(2);
    await expect(page.locator('.auction-card').filter({ hasText: 'Vintage camera' })).toContainText('₹900.00');
    state.failure = true;
    await page.clock.fastForward(15000);
    await expect(page.getByRole('alert')).toContainText(/refresh|unavailable/i);
    await expect(page.locator('.auction-card')).toHaveCount(2);
    state.failure = false;
    state.auctions = [listing({ highest_bid: 1100, bid_count: 3 })];
    await page.getByRole('button', { name: /retry|try again/i }).click();
    await expect(page.locator('.auction-card')).toHaveCount(1);
    await expect(page.locator('.auction-card')).toContainText('₹1,100.00');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('homepage card changes status when its countdown expires before the next poll', async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  const start = await pauseClock(page);
  await marketplace(page, listing({ end_time: new Date(start + 3000).toISOString() }));
  await page.goto(origin);
  await expect(page.locator('.card-live')).toHaveText('LIVE AUCTION');
  await page.clock.fastForward(4000);
  await expect(page.locator('.card-live')).toHaveText('ENDED');
  await expect(page.locator('.auction-card')).toContainText('Final price');
  await expect(page.locator('.card-countdown')).toContainText('Auction status');
});

test('slow detail requests finish before a queued refresh and survive StrictMode cleanup', async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  const state = await marketplace(page);
  state.hold = true;
  await page.goto(`${origin}/auctions/${auctionId}`);
  await page.getByRole('heading', { name: 'Opening the auction…', exact: true }).waitFor();
  await expect.poll(() => state.pending.length).toBe(2);
  await pauseClock(page);
  await page.clock.fastForward(15000);
  expect(state.pending).toHaveLength(2);
  await json(state.pending[0], [listing({ title: 'Discarded request' })]);
  await page.clock.fastForward(15000);
  expect(state.pending).toHaveLength(2);
  await json(state.pending[1], [listing()]);
  await expect(page.getByRole('heading', { name: 'Vintage camera', exact: true })).toBeVisible();
  await expect.poll(() => state.pending.length).toBe(3);
  state.hold = false;
  await json(state.pending[2], [listing({ highest_bid: 900, bid_count: 2 })]);
  await expect(page.locator('.current-bid-value')).toHaveText('₹900.00');
  await expect(page.getByRole('heading', { name: 'Discarded request', exact: true })).toHaveCount(0);
  state.hold = true;
  await page.clock.fastForward(15000);
  await expect.poll(() => state.pending.length).toBe(4);
  await page.clock.fastForward(15000);
  expect(state.pending).toHaveLength(4);
  state.hold = false;
  state.auctions = [listing(), listing({ id: missingId, title: 'Other auction' })];
  await page.clock.resume();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Explore Auctions' }).click();
  await page.getByRole('link', { name: 'Other auction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other auction', exact: true })).toBeVisible();
  await json(state.pending[3], [listing({ highest_bid: 1300, bid_count: 4 })]);
  await expect(page.getByRole('heading', { name: 'Other auction', exact: true })).toBeVisible();
  await expect(page.locator('.current-bid-value')).toHaveText('₹500.00');
});

test('invalid and missing auction links show the missing listing state', async ({ page }) => {
  const state = await marketplace(page);
  await page.goto(`${origin}/auctions/invalid`);
  await expect(page.getByRole('heading', { name: 'This auction isn’t here' })).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page.goto(`${origin}/auctions/${missingId}`);
  await expect(page.getByRole('heading', { name: 'This auction isn’t here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore auctions', exact: true }).first()).toBeVisible();
});

test('anonymous account routes return to the requested page after login', async ({ page }) => {
  await marketplace(page);
  for (const path of ['/dashboard?from=test', '/create?from=test']) {
    await page.goto(origin + path);
    await expect(page).toHaveURL(`${origin}/login`);
  }
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Password').fill('test-password');
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/create?from=test`);
  await expect(page.getByRole('heading', { name: 'Create an auction' })).toBeVisible();
});

for (const path of ['/', '/explore', `/auctions/${auctionId}`]) {
  test(`${path} stops periodic reads after navigation`, async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    const state = await marketplace(page);
    await page.goto(origin + path);
    if (path === '/explore') await page.getByLabel('Search auctions').waitFor();
    if (path.startsWith('/auctions/')) await expect(page.locator('.current-bid-value')).toBeVisible();
    else await expect(page.locator('.auction-card')).toHaveCount(1);
    await page.getByRole('link', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login`);
    await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
    await pauseClock(page);
    const requests = state.requests.length;
    await page.clock.fastForward(60000);
    expect(state.requests).toHaveLength(requests);
  });
}
