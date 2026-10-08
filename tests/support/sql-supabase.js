import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const testUsers = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'seller@example.com', name: 'Sara Seller' },
  { id: '10000000-0000-4000-8000-000000000002', email: 'buyer-a@example.com', name: 'Alex Buyer' },
  { id: '10000000-0000-4000-8000-000000000003', email: 'buyer-b@example.com', name: 'Ben Buyer' },
];

function authSession(account) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, exp, role: 'authenticated' })}.test-signature`,
    refresh_token: account.id, expires_in: 3600, expires_at: exp, token_type: 'bearer',
    user: { id: account.id, email: account.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: { full_name: account.name }, created_at: new Date().toISOString() },
  };
}

// This adapter exists only in tests. Auth and Storage HTTP are simulated; every app table query and RPC executes the real SQL with RLS.
export async function createSqlSupabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('iss','https://testproject.supabase.co/auth/v1','sub',auth.uid()) $$;
    grant usage on schema auth, storage to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner_id text, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  await db.exec(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  for (const user of testUsers) await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [user.id, JSON.stringify({ full_name: user.name })]);
  const image = await readFile(new URL('../../public/images/camera.jpg', import.meta.url));
  const requests = [];

  async function as(userId, sql, values = []) {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || '']);
      return tx.query(sql, values);
    });
  }

  async function attach(page) {
    await page.route('https://testproject.supabase.co/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = decodeURIComponent(url.pathname);
      const headers = request.headers();
      let userId = null;
      try { userId = JSON.parse(Buffer.from(headers.authorization?.split('.')[1] || '', 'base64url').toString()).sub; } catch { /* Anonymous browser key. */ }
      if (!testUsers.some(user => user.id === userId)) userId = null;
      requests.push({ method: request.method(), path, userId, query: url.search });
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      try {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
        if (path === '/auth/v1/token') {
          const body = request.postDataJSON();
          const account = url.searchParams.get('grant_type') === 'refresh_token'
            ? testUsers.find(user => user.id === body.refresh_token)
            : testUsers.find(user => user.email === body.email && body.password === 'demo-password');
          return account ? json(authSession(account)) : json({ message: 'Invalid login credentials' }, 400);
        }
        if (path === '/auth/v1/user') return userId ? json(authSession(testUsers.find(user => user.id === userId)).user) : json({ message: 'Not authenticated' }, 401);
        if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
        if (path.startsWith('/storage/v1/object/public/auction-images/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
        if (path.startsWith('/storage/v1/object/auction-images/') && request.method() === 'POST') {
          const name = path.slice('/storage/v1/object/auction-images/'.length);
          await as(userId, "insert into storage.objects(bucket_id,name,owner_id) values ('auction-images',$1,$2)", [name, userId]);
          return json({ Key: `auction-images/${name}`, Id: name });
        }
        if (path === '/storage/v1/object/auction-images' && request.method() === 'DELETE') {
          const removed = [];
          for (const name of request.postDataJSON().prefixes) {
            const result = await as(userId, "delete from storage.objects where bucket_id='auction-images' and name=$1 returning name", [name]);
            removed.push(...result.rows);
          }
          return json(removed);
        }
        if (path === '/rest/v1/rpc/place_bid') {
          const { p_auction_id, p_amount } = request.postDataJSON();
          const result = await as(userId, 'select * from public.place_bid($1,$2)', [p_auction_id, p_amount]);
          return json(result.rows[0]);
        }

        const table = path.split('/').at(-1);
        if (!['auctions', 'auction_summaries', 'bids', 'bid_history', 'profiles'].includes(table)) throw new Error(`Unsupported test request: ${path}`);
        const identifier = value => {
          if (!/^[a-z_]+$/.test(value)) throw new Error('Unsupported column in test query');
          return `"${value}"`;
        };
        const selected = url.searchParams.get('select') || '*';
        const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',');
        const values = [];
        const conditions = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
          const column = identifier(key);
          if (value.startsWith('in.(')) {
            const entries = value.slice(4, -1).split(',').map(entry => entry.replace(/^"|"$/g, ''));
            const placeholders = entries.map(entry => { values.push(entry); return `$${values.length}`; });
            conditions.push(`${column} in (${placeholders.join(',')})`);
          } else {
            const separator = value.indexOf('.');
            const op = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[value.slice(0, separator)];
            if (!op) throw new Error('Unsupported test filter');
            values.push(value.slice(separator + 1));
            conditions.push(`${column}${op}$${values.length}`);
          }
        }
        const where = conditions.length ? ` where ${conditions.join(' and ')}` : '';
        const single = headers.accept?.includes('vnd.pgrst.object');
        let result;
        if (request.method() === 'POST') {
          const row = request.postDataJSON();
          const keys = Object.keys(row);
          result = await as(userId, `insert into public.${table} (${keys.map(identifier).join(',')}) values (${keys.map((_, index) => `$${index + 1}`).join(',')}) returning ${columns}`, Object.values(row));
        } else if (request.method() === 'DELETE') {
          result = await as(userId, `delete from public.${table}${where} returning ${columns}`, values);
        } else if (request.method() === 'GET') {
          const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map(part => {
            const [column, direction] = part.split('.');
            return `${identifier(column)} ${direction === 'desc' ? 'desc' : 'asc'}`;
          }).join(',');
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
          const limit = Math.min(1000, Math.max(0, Number(url.searchParams.get('limit') || 1000)));
          result = await as(userId, `select ${columns} from public.${table}${where}${order ? ` order by ${order}` : ''} limit ${limit} offset ${offset}`, values);
        } else throw new Error(`Unsupported test method: ${request.method()}`);
        if (request.method() !== 'GET' && !headers.prefer?.includes('return=representation')) return route.fulfill({ status: request.method() === 'POST' ? 201 : 204 });
        if (single && result.rows.length !== 1) return json({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object', details: `The result contains ${result.rows.length} rows` }, 406);
        return json(single ? result.rows[0] : result.rows, request.method() === 'POST' ? 201 : 200);
      } catch (error) {
        return json({ message: error.message, code: error.code || 'TEST_ERROR' }, 400);
      }
    });
  }
  return { db, as, attach, requests, close: () => db.close() };
}
