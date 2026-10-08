import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const seller = '10000000-0000-4000-8000-000000000001'
const buyer = '10000000-0000-4000-8000-000000000002'
const rival = '10000000-0000-4000-8000-000000000003'
const legacy = '10000000-0000-4000-8000-000000000004'
const db = new PGlite()
let schema

// Only Supabase-managed auth/storage scaffolding is stubbed; application SQL runs unchanged.
before(async () => {
  await db.waitReady
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select '{"iss":"https://project.supabase.co/auth/v1"}'::jsonb $$;
    grant usage on schema auth, storage to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
    create table storage.buckets (
      id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner_id text, unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    insert into auth.users(id,raw_user_meta_data)
      values ('10000000-0000-4000-8000-000000000004', '{"full_name":"Legacy User"}');
  `)
  schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8').catch(() => '')
  if (schema) await db.exec(schema)
})

after(async () => { if (db.ready) await db.close() })

async function as(user, sql, params = []) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || ''])
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

async function auction(options = {}) {
  const id = randomUUID()
  const owner = options.seller || seller
  const image = `${owner}/${randomUUID()}.jpg`
  await as(owner, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [image, owner])
  await as(owner, `insert into public.auctions
    (id,seller_id,title,description,category,image_url,starting_price,end_time)
    values ($1,$2,'Vintage camera','A working camera with the original lens.','Electronics',$3,$4,$5)`,
  [id, owner, `https://project.supabase.co/storage/v1/object/public/auction-images/${image}`,
    options.price ?? 500, options.end ?? new Date(Date.now() + 3_600_000).toISOString()])
  return { id, image }
}

test('database installs the authenticated bidding boundary', async () => {
  const { rows } = await db.query("select proname from pg_proc join pg_namespace on pg_namespace.oid = pronamespace where nspname='public' and proname='place_bid'")
  assert.equal(rows.length, 1, 'schema must install the place_bid RPC')
})

test('signup creates private profiles and exposes no other full names', async () => {
  for (const [id, name] of [[seller, 'Sara Seller'], [buyer, 'Ben Buyer'], [rival, 'Riya Rival']]) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [id, JSON.stringify({ full_name: name })])
  }
  assert.equal((await as(null, 'select * from public.profiles')).rows.length, 0)
  assert.deepEqual((await as(legacy, 'select full_name from public.profiles')).rows, [{ full_name: 'Legacy User' }])
  assert.deepEqual((await as(buyer, 'select full_name from public.profiles')).rows, [{ full_name: 'Ben Buyer' }])
  assert.equal((await as(buyer, 'update public.profiles set full_name=$1 where id=$2 returning id', ['Changed', seller])).rows.length, 0)
  await assert.rejects(as(buyer, 'update public.profiles set id=$1 where id=$2', [seller, buyer]), /permission denied/i)
  await assert.rejects(as(buyer, 'insert into public.profiles(id,full_name) values ($1,$2)', [randomUUID(), 'Spoofed User']), /permission denied/i)
  await assert.rejects(as(buyer, 'update public.profiles set full_name=$1 where id=$2', [' ', buyer]), /check constraint/i)
})

test('signup safely truncates metadata at a whitespace boundary', async () => {
  const id = randomUUID()
  await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [id, JSON.stringify({ full_name: `${'A'.repeat(99)} B` })])
  assert.equal((await as(id, 'select full_name from public.profiles')).rows[0].full_name, 'A'.repeat(99))
})

test('listing ownership, deadlines and money are checked in the database', async () => {
  const { id } = await auction()
  const fields = await as(seller, 'select * from public.auctions where id=$1', [id])
  const row = fields.rows[0]
  assert.equal((await as(buyer, 'update public.auctions set title=$1 where id=$2 returning id', ['Stolen listing', id])).rows.length, 0)
  assert.equal((await as(buyer, 'delete from public.auctions where id=$1 returning id', [id])).rows.length, 0)
  await as(seller, 'update public.auctions set title=$1 where id=$2', ['Updated camera', id])
  await assert.rejects(as(seller, 'update public.auctions set image_url=$1 where id=$2', [row.image_url.replace('project.supabase.co', 'attacker.example'), id]), /project|uploaded/i)
  await assert.rejects(as(seller, 'update public.auctions set seller_id=$1 where id=$2', [buyer, id]), /permission denied|immutable/i)
  await assert.rejects(as(seller, "update public.auctions set created_at=clock_timestamp()-interval '1 year' where id=$1", [id]), /permission denied/i)
  for (const price of ['0', '-1', '1.001', 'NaN', 'Infinity', '1000000000.01']) {
    await assert.rejects(as(seller, 'update public.auctions set starting_price=$1 where id=$2', [price, id]), /check constraint|price/i)
  }
  await assert.rejects(as(seller, 'update public.auctions set end_time=clock_timestamp()-interval \'1 second\' where id=$1', [id]), /future|ended/i)
  await assert.rejects(as(seller, "update public.auctions set end_time='infinity' where id=$1", [id]), /check constraint/i)
  await assert.rejects(as(seller, 'update public.auctions set category=$1 where id=$2', ['Cars', id]), /check constraint/i)
  await assert.rejects(as(buyer, `insert into public.auctions(seller_id,title,description,category,image_url,starting_price,end_time)
    values ($1,$2,$3,$4,$5,500,clock_timestamp()+interval '1 hour')`, [seller, row.title, row.description, row.category, row.image_url]), /row-level security|seller/i)
  await assert.rejects(auction({ end: new Date(Date.now() - 1000).toISOString() }), /future/i)
})

test('only the RPC can write bids and authenticated identity cannot be spoofed', async () => {
  const { id } = await auction()
  await assert.rejects(as(null, 'select public.place_bid($1,500)', [id]), /permission denied|sign in/i)
  await db.exec('set role authenticated')
  try {
    await assert.rejects(db.query('select public.place_bid($1,500)', [id]), /sign in/i)
  } finally {
    await db.exec('reset role')
  }
  await assert.rejects(as(seller, 'select public.place_bid($1,500)', [id]), /own auction/i)
  await assert.rejects(as(buyer, 'insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,500)', [id, rival]), /permission denied/i)
  await assert.rejects(as(buyer, 'select public.place_bid($1,500,$2)', [id, rival]), /does not exist/i)
  await as(buyer, 'select public.place_bid($1,500)', [id])
  assert.deepEqual((await as(null, 'select bidder_id,amount from public.bids where auction_id=$1', [id])).rows, [{ bidder_id: buyer, amount: '500' }])
  await assert.rejects(as(buyer, 'update public.bids set amount=1 where auction_id=$1', [id]), /permission denied/i)
  await assert.rejects(as(buyer, 'delete from public.bids where auction_id=$1', [id]), /permission denied/i)
  await assert.rejects(as(buyer, "update public.bid_history set created_at=clock_timestamp() where auction_id=$1", [id]), /permission denied|cannot update view/i)
})

test('bids enforce exact money, starting price, and the current highest plus 100', async () => {
  const { id } = await auction()
  for (const amount of [null, '0', '-1', '499.99', '500.001', 'NaN', 'Infinity', '1000000000.01']) {
    await assert.rejects(as(buyer, 'select public.place_bid($1,$2)', [id, amount]), /amount|minimum/i)
  }
  await as(buyer, 'select public.place_bid($1,500)', [id])
  assert.equal((await db.query('select b.created_at < a.end_time as before_deadline from public.bids b join public.auctions a on a.id=b.auction_id where a.id=$1', [id])).rows[0].before_deadline, true)
  await assert.rejects(as(rival, 'select public.place_bid($1,599.99)', [id]), /minimum.*600/i)
  await as(rival, 'select public.place_bid($1,600)', [id])
  await assert.rejects(as(buyer, 'select public.place_bid($1,600)', [id]), /minimum.*700/i)
  const { rows } = await as(null, 'select highest_bid,bid_count,highest_bidder_id,winner_id,seller_name from public.auction_summaries where id=$1', [id])
  assert.deepEqual(rows, [{ highest_bid: '600', bid_count: 2, highest_bidder_id: rival, winner_id: null, seller_name: 'Sara' }])
  assert.deepEqual((await as(null, 'select bidder_name from public.bid_history where auction_id=$1 order by amount', [id])).rows, [{ bidder_name: 'Ben' }, { bidder_name: 'Riya' }])
  await assert.rejects(as(seller, 'update public.auction_summaries set title=$1 where id=$2', ['Oops', id]), /permission denied|cannot update view|not automatically updatable/i)
  await assert.rejects(as(buyer, 'select public.place_bid($1,500)', [randomUUID()]), /not found/i)
})

test('a listing becomes immutable after its first bid', async () => {
  const { id } = await auction()
  await as(buyer, 'select public.place_bid($1,500)', [id])
  await assert.rejects(as(seller, 'update public.auctions set end_time=clock_timestamp()+interval \'2 hours\' where id=$1', [id]), /bids/i)
  await assert.rejects(as(seller, 'delete from public.auctions where id=$1', [id]), /bids/i)
  const empty = await auction()
  assert.equal((await as(seller, 'delete from public.auctions where id=$1 returning id', [empty.id])).rows.length, 1)
})

test('server deadlines reject late bids and expose the winner without a worker', async () => {
  const { id } = await auction({ end: new Date(Date.now() + 1000).toISOString() })
  await as(buyer, 'select public.place_bid($1,500)', [id])
  await new Promise(resolve => setTimeout(resolve, 1100))
  await assert.rejects(as(rival, 'select public.place_bid($1,600)', [id]), /ended/i)
  assert.deepEqual((await as(null, 'select winner_id,winner_name from public.auction_summaries where id=$1', [id])).rows, [{ winner_id: buyer, winner_name: 'Ben' }])
  const empty = await auction({ end: new Date(Date.now() + 250).toISOString() })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal((await as(null, 'select winner_id from public.auction_summaries where id=$1', [empty.id])).rows[0].winner_id, null)
  await assert.rejects(as(seller, "update public.auctions set end_time=clock_timestamp()+interval '1 hour' where id=$1", [empty.id]), /ended/i)
  await assert.rejects(as(seller, 'delete from public.auctions where id=$1', [empty.id]), /ended/i)
})

test('a bid that finishes writing after the deadline is rolled back', async () => {
  const { id } = await auction()
  // A delayed constraint trigger models work that blocks inside INSERT, not multi-connection contention.
  await db.exec(`
    create function public.bidverse_test_slow_bid() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.6); return new; end; $$;
    create constraint trigger bidverse_test_slow_bid after insert on public.bids
      for each row execute function public.bidverse_test_slow_bid();
    alter table public.auctions disable trigger bidverse_guard_auction;
  `)
  try {
    await db.query("update public.auctions set end_time=clock_timestamp()+interval '300 milliseconds' where id=$1", [id])
    await assert.rejects(as(buyer, 'select public.place_bid($1,500)', [id]), /ended/i)
    assert.equal((await as(null, 'select * from public.bids where auction_id=$1', [id])).rows.length, 0)
  } finally {
    await db.exec(`
      alter table public.auctions enable trigger bidverse_guard_auction;
      drop trigger bidverse_test_slow_bid on public.bids;
      drop function public.bidverse_test_slow_bid();
    `)
  }
})

test('listing deadlines are rechecked after waiting for image locks', async () => {
  const update = await auction()
  const extend = await auction()
  const image = `${seller}/${randomUUID()}.jpg`
  const guardDefinition = schema.slice(schema.indexOf('create or replace function bidverse_private.guard_auction()'),
    schema.indexOf('\ndrop trigger if exists bidverse_guard_auction'))
  await as(seller, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [image, seller])
  // Preserve the real lock, then inject a wait in this isolated database's lock function.
  await db.exec(`
    alter function pg_catalog.pg_advisory_xact_lock(bigint) rename to bidverse_test_original_image_lock;
    create function pg_catalog.pg_advisory_xact_lock(bigint) returns void language plpgsql volatile as $$
      begin
        perform pg_catalog.bidverse_test_original_image_lock($1);
        perform pg_sleep(0.6);
      end;
    $$;
  `)
  await db.exec(guardDefinition)
  try {
    await assert.rejects(as(seller, `insert into public.auctions
      (seller_id,title,description,category,image_url,starting_price,end_time)
      values ($1,'Slow image lock','A listing that expires while its image lock waits.','Other',$2,500,
        clock_timestamp()+interval '300 milliseconds')`,
    [seller, `https://project.supabase.co/storage/v1/object/public/auction-images/${image}`]), /future|ended/i)
    for (const [id, sql] of [
      [update.id, "update public.auctions set title='Expired during image lock' where id=$1"],
      [extend.id, "update public.auctions set end_time=clock_timestamp()+interval '2 hours' where id=$1"],
    ]) {
      await db.exec('alter table public.auctions disable trigger bidverse_guard_auction')
      await db.query("update public.auctions set end_time=clock_timestamp()+interval '300 milliseconds' where id=$1", [id])
      await db.exec('alter table public.auctions enable trigger bidverse_guard_auction')
      await assert.rejects(as(seller, sql, [id]), /future|ended/i)
    }
    assert.equal((await db.query('select title from public.auctions where id=$1', [update.id])).rows[0].title, 'Vintage camera')
  } finally {
    await db.exec(`
      alter table public.auctions enable trigger bidverse_guard_auction;
      drop function pg_catalog.pg_advisory_xact_lock(bigint);
      alter function pg_catalog.bidverse_test_original_image_lock(bigint) rename to pg_advisory_xact_lock;
    `)
    await db.exec(guardDefinition)
  }
})

test('active prices, minimums, counts and history exclude future-stamped administrative bids', async () => {
  const { id } = await auction()
  await as(buyer, 'select public.place_bid($1,500)', [id])
  await db.query(`insert into public.bids(auction_id,bidder_id,amount,created_at)
    select id,$2,900,end_time+interval '1 second' from public.auctions where id=$1`, [id, rival])
  const bidResult = await as(rival, 'select public.place_bid($1,600)', [id]).then(() => 'accepted', error => error.message)
  const summary = (await as(null, 'select highest_bid,bid_count,highest_bidder_id,winner_id from public.auction_summaries where id=$1', [id])).rows
  const history = (await as(null, 'select amount from public.bid_history where auction_id=$1 order by amount', [id])).rows
  assert.deepEqual({ bidResult, summary, history }, {
    bidResult: 'accepted',
    summary: [{ highest_bid: '600', bid_count: 2, highest_bidder_id: rival, winner_id: null }],
    history: [{ amount: '500' }, { amount: '600' }],
  })
  assert.equal((await db.query('select count(*)::int count from public.bids where auction_id=$1', [id])).rows[0].count, 3)
})

test('winner, current price, count and history exclude bids stamped at or after the deadline', async () => {
  const { id } = await auction()
  await as(buyer, 'select public.place_bid($1,500)', [id])
  await db.exec('alter table public.auctions disable trigger bidverse_guard_auction')
  try {
    await db.query("update public.auctions set end_time=clock_timestamp()-interval '1 second' where id=$1", [id])
    await db.query("update public.bids set created_at=(select end_time-interval '1 second' from public.auctions where id=$1) where auction_id=$1", [id])
    await db.query(`insert into public.bids(auction_id,bidder_id,amount,created_at)
      select id,$2::uuid,600,end_time from public.auctions where id=$1
      union all select id,$2::uuid,700,end_time+interval '1 second' from public.auctions where id=$1`, [id, rival])
    assert.deepEqual((await as(null, 'select highest_bid,bid_count,highest_bidder_id,winner_id,winner_name from public.auction_summaries where id=$1', [id])).rows,
      [{ highest_bid: '500', bid_count: 1, highest_bidder_id: buyer, winner_id: buyer, winner_name: 'Ben' }])
    assert.deepEqual((await as(null, 'select amount from public.bid_history where auction_id=$1', [id])).rows, [{ amount: '500' }])
  } finally {
    await db.exec('alter table public.auctions enable trigger bidverse_guard_auction')
  }
})

test('storage restricts uploads, overwrites, deletion and advertised bucket limits', async () => {
  const { id, image } = await auction()
  const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='auction-images'")).rows[0]
  assert.deepEqual(bucket, { public: true, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] })
  await assert.rejects(as(buyer, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [`${seller}/intruder.jpg`, buyer]), /row-level security/i)
  await assert.rejects(as(buyer, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [`${buyer}/spoof.jpg`, seller]), /row-level security/i)
  await assert.rejects(as(null, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [`${buyer}/anonymous.jpg`, buyer]), /row-level security/i)
  assert.equal((await as(seller, "update storage.objects set name='overwrite.jpg' where name=$1 returning id", [image])).rows.length, 0)
  assert.equal((await as(buyer, 'delete from storage.objects where name=$1 returning id', [image])).rows.length, 0)
  assert.equal((await as(seller, 'delete from storage.objects where name=$1 returning id', [image])).rows.length, 0)
  await as(seller, 'delete from public.auctions where id=$1', [id])
  assert.equal((await as(seller, 'delete from storage.objects where name=$1 returning id', [image])).rows.length, 1)
})

test('rerunning setup preserves auctions and bids and keeps Realtime enrollment unique', async () => {
  const before = (await db.query('select count(*)::int count from public.bids')).rows[0].count
  await db.exec(schema)
  assert.equal((await db.query('select count(*)::int count from public.bids')).rows[0].count, before)
  assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows, [{ tablename: 'auctions' }, { tablename: 'bids' }])
  assert.equal((await as(buyer, 'select * from public.profiles')).rows.length, 1)
})
