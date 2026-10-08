import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:5174';
const seller = '10000000-0000-4000-8000-000000000001';
const buyer = '10000000-0000-4000-8000-000000000002';
const auctionId = '10000000-0000-4000-8000-000000000010';
const account = { id: seller, aud: 'authenticated', role: 'authenticated', email: 'seller@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: 'Sara Seller' }, created_at: new Date().toISOString() };
function session(expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: seller, role: 'authenticated', exp: expiresAt })).toString('base64url')}.test-signature`;
  return { access_token: token, refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user: account };
}
const listing = overrides => ({ id: auctionId, seller_id: seller, title: 'Vintage camera', description: 'A working camera with its original lens and case.', category: 'Electronics', image_url: `https://testproject.supabase.co/storage/v1/object/public/auction-images/${seller}/photo.jpg`, starting_price: 500, highest_bid: null, bid_count: 0, end_time: new Date(Date.now() + 3600000).toISOString(), created_at: new Date().toISOString(), seller_name: 'Sara', highest_bidder_id: null, winner_id: null, winner_name: null, ...overrides });

async function mockClient(page, options = {}) {
  const state = { listings: [listing()], uploads: [], cleanups: [], creates: [], deletes: [], signups: [], logins: [], ...options };
  await page.route('https://testproject.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const rows = data => data.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 1000));
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/auth/v1/token')) {
      state.logins.push(request.postDataJSON());
      if (state.authFailure) return json({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(session());
    }
    if (url.pathname.endsWith('/auth/v1/signup')) { state.signups.push(url); return json({ user: account, session: null }); }
    if (url.pathname.endsWith('/auth/v1/user')) return json(account);
    if (url.pathname.includes('/storage/v1/object/')) {
      if (request.method() === 'DELETE') { state.cleanups.push(request.postDataJSON()); return state.cleanupFailure ? json({ message: 'Storage cleanup denied' }, 403) : json([]); }
      if (request.method() === 'POST') { state.uploads.push(url.pathname); return state.uploadFailure ? json({ message: 'Image upload denied' }, 403) : json({ Key: url.pathname }); }
      return route.fulfill({ path: 'public/images/camera.jpg', contentType: 'image/jpeg' });
    }
    if (url.pathname.endsWith('/rest/v1/auction_summaries')) {
      if (state.readFailure) return json({ message: 'Dashboard request failed' }, 500);
      const filtered = state.listings.filter(item => !url.searchParams.has('seller_id') || url.searchParams.get('seller_id') === `eq.${item.seller_id}`);
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? filtered[0] : rows(filtered));
    }
    if (url.pathname.endsWith('/rest/v1/bids') || url.pathname.endsWith('/rest/v1/bid_history')) return json([]);
    if (url.pathname.endsWith('/rest/v1/auctions') && request.method() === 'POST') {
      state.creates.push(request.postDataJSON());
      if (state.createFailure) return json(state.createFailure, 400);
      state.listings = [listing(state.creates.at(-1))];
      return json({ id: auctionId }, 201);
    }
    if (url.pathname.endsWith('/rest/v1/auctions') && request.method() === 'DELETE') {
      state.deletes.push(url);
      if (state.deleteFailure) return json({ code: '22023', message: 'An auction with bids cannot be changed or deleted.' }, 400);
      if (state.deleteMissing) return json([]);
      state.listings = [];
      return json([{ id: auctionId }]);
    }
    return json({ message: `Unhandled client test request: ${url.pathname}` }, 400);
  });
  return state;
}
async function authenticate(page, expiresAt) {
  await page.addInitScript(value => localStorage.setItem('sb-testproject-auth-token', JSON.stringify(value)), session(expiresAt));
}
async function fillAuction(page) {
  await page.goto(`${origin}/create`);
  await page.getByLabel('Item title').fill('Vintage camera');
  await page.getByLabel('Description', { exact: true }).fill('A working camera with its original lens and case.');
  await page.getByLabel('Category', { exact: true }).selectOption('Electronics');
  await page.getByLabel('Starting price').fill('500');
  await page.getByLabel('Auction end date').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
}

test('existing accounts can log in with a valid six-character password', async ({ page }) => {
  const state = await mockClient(page);
  await page.goto(`${origin}/login?redirect=/create`);
  await page.getByLabel('Email address').fill('seller@example.com');
  await page.getByLabel('Password').fill('secret');
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/create`);
  expect(state.logins[0].password).toBe('secret');
});

test('signup still requires at least eight password characters', async ({ page }) => {
  const state = await mockClient(page);
  await page.goto(`${origin}/login?mode=signup`);
  await page.getByLabel('Full name').fill('Sara Seller');
  await page.getByLabel('Email address').fill('seller@example.com');
  await page.getByLabel('Password').fill('secret');
  await page.getByRole('button', { name: 'Create my account' }).click();
  expect(await page.getByLabel('Password').evaluate(input => input.validity.tooShort)).toBe(true);
  expect(state.signups).toEqual([]);
});

test('email confirmation retains a safe destination and rejects external destinations', async ({ page }) => {
  const state = await mockClient(page);
  for (const [redirect, expected] of [['/create', '/create'], ['//attacker.example', '/dashboard']]) {
    await page.goto(`${origin}/login?mode=signup&redirect=${encodeURIComponent(redirect)}`);
    await page.getByLabel('Full name').fill('Sara Seller');
    await page.getByLabel('Email address').fill('seller@example.com');
    await page.getByLabel('Password').fill('new-password');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('Check your email for a confirmation link.', { exact: false })).toBeVisible();
    const confirmation = new URL(state.signups.at(-1).searchParams.get('redirect_to'));
    expect(confirmation.origin).toBe(origin);
    expect(confirmation.pathname).toBe('/login');
    expect(confirmation.searchParams.get('redirect')).toBe(expected);
  }
  const confirmed = session();
  const fragment = new URLSearchParams({ access_token: confirmed.access_token, refresh_token: confirmed.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'signup' });
  await page.goto(`${state.signups[0].searchParams.get('redirect_to')}#${fragment}`);
  await expect(page).toHaveURL(`${origin}/create`);
});

test('rejected login credentials stay visible without reporting success', async ({ page }) => {
  await mockClient(page, { authFailure: true });
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email address').fill('seller@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid login credentials');
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.locator('.toast-success')).toHaveCount(0);
  await expect(page.locator('form').getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
});

test('expired sessions with rejected refresh tokens return to login', async ({ page }) => {
  const state = await mockClient(page, { authFailure: true });
  await authenticate(page, Math.floor(Date.now() / 1000) - 60);
  await page.goto(`${origin}/dashboard`);
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByLabel('Email address')).toBeEnabled();
  expect(state.logins[0].refresh_token).toBe('test-refresh-token');
  await expect(page.locator('.dashboard-table')).toHaveCount(0);
});

test('a stalled session check shows an error and recovers when refresh succeeds', async ({ page }) => {
  await page.clock.install();
  await mockClient(page);
  await authenticate(page, Math.floor(Date.now() / 1000) - 60);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/v1/token*', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(session()) });
  });
  try {
    await page.goto(`${origin}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Checking your account...' })).toBeVisible();
    await page.clock.fastForward(13000);
    await expect(page).toHaveURL(`${origin}/login`);
    await expect(page.getByRole('alert')).toContainText('Your session could not be checked');
    release();
    await expect(page).toHaveURL(`${origin}/dashboard`);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});

test('expired email confirmation errors explain why no session was created', async ({ page }) => {
  await mockClient(page);
  await page.goto(`${origin}/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await expect(page.getByRole('alert')).toContainText('Email link is invalid or has expired');
  await expect(page.locator('form').getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
});

test('a file with JPEG metadata but invalid image bytes is rejected before upload', async ({ page }) => {
  const state = await mockClient(page);
  await authenticate(page);
  await fillAuction(page);
  await page.getByLabel('Item photo').setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo') });
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page.getByRole('alert')).toContainText('valid JPG, PNG, or WebP');
  expect(state.uploads).toEqual([]);
  expect(state.creates).toEqual([]);
});

test('photo selection rejects unsupported types, empty files and files above five MB', async ({ page }) => {
  const state = await mockClient(page);
  await authenticate(page);
  await fillAuction(page);
  for (const [name, mimeType, buffer] of [
    ['document.txt', 'text/plain', Buffer.from('document')],
    ['empty.jpg', 'image/jpeg', Buffer.alloc(0)],
    ['large.jpg', 'image/jpeg', Buffer.alloc(5 * 1024 * 1024 + 1)],
  ]) {
    await page.getByLabel('Item photo').setInputFiles({ name, mimeType, buffer });
    await expect(page.getByRole('alert')).toContainText('up to 5 MB');
    expect(await page.getByLabel('Item photo').evaluate(input => input.files.length)).toBe(0);
  }
  expect(state.uploads).toEqual([]);
});

test('upload failures cannot create a listing or announce it was published', async ({ page }) => {
  const state = await mockClient(page, { uploadFailure: true });
  await authenticate(page);
  await fillAuction(page);
  await page.getByLabel('Item photo').setInputFiles('public/images/camera.jpg');
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page.getByRole('alert')).toContainText('Image upload denied');
  expect(state.creates).toEqual([]);
  expect(state.cleanups).toEqual([]);
  await expect(page.locator('.toast-success')).toHaveCount(0);
});

test('definite insert failures clean the upload and uncertain responses retain it', async ({ page }) => {
  const state = await mockClient(page, { createFailure: { code: '22023', message: 'Auction end time must be in the future.' } });
  await authenticate(page);
  await fillAuction(page);
  await page.getByLabel('Item photo').setInputFiles('public/images/camera.jpg');
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page.getByRole('alert')).toContainText('Auction end time must be in the future');
  expect(state.cleanups).toHaveLength(1);
  state.createFailure = { message: 'Failed to fetch' };
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page.getByRole('alert')).toContainText('Check your dashboard before retrying');
  expect(state.cleanups).toHaveLength(1);
  await expect(page.locator('.toast-success')).toHaveCount(0);
});

test('seller listings show server winners and auctions that ended without bids', async ({ page }) => {
  await mockClient(page, { listings: [
    listing({ end_time: new Date(Date.now() - 1000).toISOString(), highest_bid: 700, bid_count: 2, winner_id: buyer, winner_name: 'Ben' }),
    listing({ id: '10000000-0000-4000-8000-000000000011', title: 'Unsold camera', end_time: new Date(Date.now() - 1000).toISOString() }),
    listing({ id: '10000000-0000-4000-8000-000000000012', title: 'Pending camera', end_time: new Date(Date.now() - 1000).toISOString(), highest_bid: 500, bid_count: 1, highest_bidder_id: buyer }),
  ] });
  await authenticate(page);
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator('.dashboard-table').getByText('Won by Ben', { exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-table').getByText('No bids received', { exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-table').getByText('Confirming result...', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
});

test('seller deletion respects cancellation and denied or missing-row responses', async ({ page }) => {
  const state = await mockClient(page);
  await authenticate(page);
  await page.goto(`${origin}/dashboard`);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete Vintage camera' }).click();
  expect(state.deletes).toEqual([]);
  state.deleteFailure = true;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Vintage camera' }).click();
  await expect(page.locator('.toast-error')).toContainText('with bids');
  expect(state.cleanups).toEqual([]);
  state.deleteFailure = false;
  state.deleteMissing = true;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Vintage camera' }).click();
  await expect(page.locator('.toast-error')).toContainText('not deleted');
  expect(state.cleanups).toEqual([]);
  await expect(page.locator('.toast-success')).toHaveCount(0);
});

test('confirmed deletion cleans its owned image and reports storage cleanup failures', async ({ page }) => {
  test.setTimeout(60000);
  const state = await mockClient(page, { cleanupFailure: true });
  await authenticate(page);
  await page.goto(`${origin}/dashboard`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Vintage camera' }).click();
  await expect(page.locator('.toast-error')).toContainText('Listing deleted, but its uploaded image could not be removed.');
  expect(state.cleanups).toEqual([{ prefixes: [`${seller}/photo.jpg`] }]);
  await expect(page.getByRole('heading', { name: 'Your first listing is waiting' })).toBeVisible();
});

test('successful seller deletion removes the listing and its owned image', async ({ page }) => {
  const state = await mockClient(page);
  await authenticate(page);
  await page.goto(`${origin}/dashboard`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Vintage camera' }).click();
  await expect(page.locator('.toast-success')).toContainText('Your auction was deleted.');
  expect(state.cleanups).toEqual([{ prefixes: [`${seller}/photo.jpg`] }]);
  await expect(page.getByRole('heading', { name: 'Your first listing is waiting' })).toBeVisible();
});

test('dashboard refresh failures label stale data and recover when retried', async ({ page }) => {
  await page.clock.install();
  const state = await mockClient(page);
  await authenticate(page);
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator('.dashboard-table tbody tr')).toHaveCount(1);
  state.readFailure = true;
  await page.clock.fastForward(15000);
  await expect(page.getByRole('alert')).toContainText('Showing the last loaded data');
  await expect(page.locator('.dashboard-table tbody tr')).toHaveCount(1);
  state.readFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.dashboard-table tbody tr')).toHaveCount(1);
});
