import { test, expect } from '@playwright/test';
import { createSqlSupabase, testUsers } from '../support/sql-supabase.js';

const origin = 'http://127.0.0.1:5174';

async function login(page, account, destination = '/dashboard') {
  await page.goto(`${origin}/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password').fill('demo-password');
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}${destination}`);
}

async function createAuction(page, title) {
  await page.goto(`${origin}/create`);
  await page.getByLabel('Item title').fill(title);
  await page.getByLabel('Description', { exact: true }).fill('A working camera with original lens. Honest condition and original photo.');
  await page.getByLabel('Category', { exact: true }).selectOption('Electronics');
  await page.getByLabel('Starting price').fill('500');
  await page.getByLabel('Auction end date').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByLabel('Item photo').setInputFiles('public/images/camera.jpg');
  await page.getByRole('button', { name: 'Publish auction' }).click();
  await expect(page).toHaveURL(/\/auctions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1);
}

test('actual SQL-backed seller → two buyers → expiry → winner/dashboard flow', async ({ browser }) => {
  test.setTimeout(90000);
  const api = await createSqlSupabase();
  const contexts = await Promise.all(testUsers.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [sellerPage, buyerA, buyerB] = pages;
  const pageErrors = [];
  for (const page of pages) { await api.attach(page); page.on('pageerror', error => pageErrors.push(error.message)); }
  await buyerA.clock.install({ time: Date.now() });
  try {
    await sellerPage.goto(`${origin}/create`);
    await expect(sellerPage).toHaveURL(`${origin}/login`);
    await sellerPage.getByLabel('Email address').fill(testUsers[0].email);
    await sellerPage.getByLabel('Password').fill('demo-password');
    await sellerPage.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(sellerPage).toHaveURL(`${origin}/create`);
    const auctionId = await createAuction(sellerPage, 'SQL flow camera');
    const stored = (await api.db.query('select * from public.auctions where id=$1', [auctionId])).rows[0];
    expect(stored.seller_id).toBe(testUsers[0].id);
    expect((await api.db.query('select count(*)::int count from storage.objects')).rows[0].count).toBe(1);
    await expect(sellerPage.getByText('This is your auction.', { exact: false })).toBeVisible();
    await expect(sellerPage.getByRole('button', { name: 'Place bid' })).toHaveCount(0);

    await login(buyerA, testUsers[1], '/explore');
    await login(buyerB, testUsers[2], '/explore');
    await expect(buyerA.getByRole('link', { name: 'SQL flow camera', exact: true })).toBeVisible();
    // Set a short deadline through the same owner-only UPDATE rules, before the first bid.
    await api.as(testUsers[0].id, "update public.auctions set end_time=clock_timestamp()+interval '20 seconds' where id=$1", [auctionId]);
    await buyerA.goto(`${origin}/auctions/${auctionId}`);
    await buyerA.getByLabel('Your bid', { exact: true }).fill('499.99');
    await buyerA.getByRole('button', { name: 'Place bid', exact: true }).click();
    await expect(buyerA.getByRole('alert')).toContainText('at least');
    await buyerA.getByLabel('Your bid', { exact: true }).fill('500');
    await buyerA.getByRole('button', { name: 'Place bid', exact: true }).click();
    await expect(buyerA.getByText('Your bid was placed successfully.')).toBeVisible();
    await expect(buyerA.locator('.bid-list .bid-row')).toHaveCount(1);
    await buyerA.getByRole('button', { name: 'Dismiss notification' }).click();
    await buyerA.getByLabel('Your bid', { exact: true }).fill('600');
    // Keep Buyer A's display stale; PostgreSQL and Buyer B still advance normally.
    await buyerA.clock.pauseAt(Date.now());

    await buyerB.goto(`${origin}/auctions/${auctionId}`);
    await expect(buyerB.locator('.current-bid-value')).toHaveText('₹500.00');
    await buyerB.getByLabel('Your bid', { exact: true }).fill('600');
    await buyerB.getByRole('button', { name: 'Place bid', exact: true }).click();
    await expect(buyerB.getByText('Your bid was placed successfully.')).toBeVisible();
    await expect(buyerB.locator('.bid-list .bid-row')).toHaveCount(2);
    const rpcCount = () => api.requests.filter(request => request.path === '/rest/v1/rpc/place_bid' && request.userId === testUsers[1].id).length;
    const beforeStaleBid = rpcCount();
    await buyerA.getByRole('button', { name: 'Place bid', exact: true }).click();
    await expect(buyerA.getByRole('alert')).toContainText('700');
    expect(rpcCount()).toBe(beforeStaleBid + 1);
    await expect(buyerA.getByText('Your bid was placed successfully.')).toHaveCount(0);
    await expect(buyerB.getByText('You', { exact: true })).toBeVisible();

    await buyerA.clock.resume();
    await buyerA.goto(`${origin}/dashboard`);
    await expect(buyerA.locator('.account-bid-row .status-badge').first()).toHaveText('Outbid');
    await expect(buyerA.locator('.stat-card').nth(0).locator('strong')).toHaveText('0');
    await expect(buyerA.locator('.stat-card').nth(2).locator('strong')).toHaveText('1');
    await buyerB.goto(`${origin}/auctions/${auctionId}`);
    await expect(buyerB.getByText('You won this auction!', { exact: true })).toBeVisible({ timeout: 25000 });
    await expect(buyerB.getByRole('button', { name: 'Place bid' })).toHaveCount(0);
    await expect(api.as(testUsers[1].id, 'select * from public.place_bid($1,700)', [auctionId])).rejects.toThrow(/ended/i);

    await buyerB.goto(`${origin}/dashboard`);
    await expect(buyerB.locator('.stat-card').nth(3).locator('strong')).toHaveText('1');
    await buyerA.goto(`${origin}/dashboard`);
    await expect(buyerA.locator('.stat-card').nth(3).locator('strong')).toHaveText('0');
    await sellerPage.goto(`${origin}/dashboard`);
    await expect(sellerPage.getByText('Won by Ben', { exact: false })).toBeVisible();
    await expect(sellerPage.getByRole('button', { name: 'Delete SQL flow camera' })).toHaveCount(0);
    const bids = (await api.db.query('select bidder_id,amount,created_at from public.bids where auction_id=$1 order by amount', [auctionId])).rows;
    expect(bids.map(bid => [bid.bidder_id, bid.amount])).toEqual([[testUsers[1].id, '500'], [testUsers[2].id, '600']]);
    const finalAuction = (await api.as(null, 'select * from public.auction_summaries where id=$1', [auctionId])).rows[0];
    expect(finalAuction.winner_id).toBe(testUsers[2].id);
    expect(bids.every(bid => new Date(bid.created_at) < new Date(finalAuction.end_time))).toBe(true);
    await sellerPage.getByRole('button', { name: 'Log out' }).click();
    await expect(sellerPage).toHaveURL(`${origin}/login`);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await api.close();
  }
});

test('actual RLS-backed deletion, missing details, profile privacy and no-bid expiry', async ({ browser }) => {
  test.setTimeout(45000);
  const api = await createSqlSupabase();
  const context = await browser.newContext();
  const page = await context.newPage();
  await api.attach(page);
  try {
    await login(page, testUsers[0]);
    const id = await createAuction(page, 'Delete this camera');
    await expect(api.as(testUsers[1].id, 'delete from public.auctions where id=$1 returning id', [id])).resolves.toMatchObject({ rows: [] });
    expect((await api.as(testUsers[1].id, 'select * from public.profiles')).rows.map(profile => profile.id)).toEqual([testUsers[1].id]);
    await page.goto(`${origin}/dashboard`);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete Delete this camera' }).click();
    expect((await api.db.query('select id from public.auctions where id=$1', [id])).rows).toHaveLength(1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete Delete this camera' }).click();
    await expect(page.getByText('Your auction was deleted.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your first listing is waiting' })).toBeVisible();
    expect((await api.db.query('select * from storage.objects')).rows).toHaveLength(0);
    await page.goto(`${origin}/auctions/${id}`);
    await expect(page.getByRole('heading', { name: 'This auction isn’t here' })).toBeVisible();
    const emptyId = await createAuction(page, 'No bids camera');
    await api.as(testUsers[0].id, "update public.auctions set end_time=clock_timestamp()+interval '1 second' where id=$1", [emptyId]);
    await page.reload();
    await expect(page.getByText('Ended with no bids', { exact: true })).toBeVisible({ timeout: 5000 });
    expect((await api.as(null, 'select winner_id,bid_count from public.auction_summaries where id=$1', [emptyId])).rows[0]).toMatchObject({ winner_id: null, bid_count: 0 });
  } finally { await context.close(); await api.close(); }
});
