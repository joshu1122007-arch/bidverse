-- Run this complete script in the Supabase SQL Editor as the project administrator.
-- Safe to rerun against this schema: no application records are dropped.
begin;

create schema if not exists bidverse_private;
revoke all on schema bidverse_private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (full_name = btrim(full_name) and char_length(full_name) between 1 and 100),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  title text not null check (char_length(btrim(title)) between 3 and 100),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  category text not null check (category in ('Electronics', 'Fashion', 'Collectibles', 'Art', 'Accessories', 'Other')),
  image_url text not null check (image_url ~ '^https://[^/]+/' and char_length(image_url) <= 2048),
  -- Unconstrained numeric preserves input precision so the check rejects, rather than rounds, fractions of a paisa.
  starting_price numeric not null check (starting_price > 0 and starting_price <= 1000000000 and starting_price = trunc(starting_price, 2)),
  end_time timestamptz not null check (isfinite(end_time)),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id),
  bidder_id uuid not null references public.profiles(id),
  amount numeric not null check (amount > 0 and amount <= 1000000000 and amount = trunc(amount, 2)),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists auctions_end_time_idx on public.auctions(end_time);
create index if not exists auctions_seller_idx on public.auctions(seller_id, created_at desc);
create index if not exists bids_highest_idx on public.bids(auction_id, amount desc, created_at, id);
create index if not exists bids_bidder_idx on public.bids(bidder_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.auctions enable row level security;
alter table public.bids enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists auctions_public_read on public.auctions;
create policy auctions_public_read on public.auctions for select to anon, authenticated using (true);
drop policy if exists auctions_insert_own on public.auctions;
create policy auctions_insert_own on public.auctions for insert to authenticated with check (seller_id = (select auth.uid()));
drop policy if exists auctions_update_own on public.auctions;
create policy auctions_update_own on public.auctions for update to authenticated
  using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));
drop policy if exists auctions_delete_own on public.auctions;
create policy auctions_delete_own on public.auctions for delete to authenticated using (seller_id = (select auth.uid()));
drop policy if exists bids_public_read on public.bids;
create policy bids_public_read on public.bids for select to anon, authenticated using (true);

revoke all on public.profiles, public.auctions, public.bids from public, anon, authenticated;
grant select on public.profiles, public.auctions, public.bids to anon, authenticated;
grant update (full_name) on public.profiles to authenticated;
grant insert (id, seller_id, title, description, category, image_url, starting_price, end_time) on public.auctions to authenticated;
grant update (title, description, category, image_url, starting_price, end_time) on public.auctions to authenticated;
grant delete on public.auctions to authenticated;

create or replace function bidverse_private.handle_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, btrim(left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), 'Bidder'), 100)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists bidverse_auth_user_created on auth.users;
create trigger bidverse_auth_user_created after insert on auth.users
  for each row execute function bidverse_private.handle_signup();

insert into public.profiles(id, full_name)
select id, btrim(left(coalesce(nullif(btrim(raw_user_meta_data->>'full_name'), ''), 'Bidder'), 100))
from auth.users on conflict (id) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('auction-images', 'auction-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The matching advisory lock prevents upload deletion racing with a new listing reference.
create or replace function bidverse_private.image_is_unreferenced(p_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or split_part(p_name, '/', 1) <> auth.uid()::text then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auction-images/' || p_name, 0));
  return not exists (
    select 1 from public.auctions a
    where split_part(a.image_url, '/storage/v1/object/public/auction-images/', 2) = p_name
  );
end;
$$;

drop policy if exists bidverse_images_read on storage.objects;
create policy bidverse_images_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'auction-images');
drop policy if exists bidverse_images_insert on storage.objects;
create policy bidverse_images_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'auction-images'
  and owner_id = (select auth.uid())::text
  and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]*[.](jpg|jpeg|png|webp)$'
);
drop policy if exists bidverse_images_delete on storage.objects;
create policy bidverse_images_delete on storage.objects for delete to authenticated using (
  bucket_id = 'auction-images'
  and owner_id = (select auth.uid())::text
  and bidverse_private.image_is_unreferenced(name)
);
-- No UPDATE policy: upserts/overwrites of existing auction images are not allowed.

create or replace function bidverse_private.guard_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_image_name text;
  v_issuer text := auth.jwt()->>'iss';
  v_origin text;
begin
  if tg_op <> 'INSERT' then
    -- UPDATE/DELETE already lock their target; explicitly use the same lock as place_bid.
    perform 1 from public.auctions where id = old.id for update;
    if auth.uid() is null or auth.uid() <> old.seller_id then
      raise exception 'Only the seller can change this auction.' using errcode = '42501';
    end if;
    if old.end_time <= clock_timestamp() then
      raise exception 'This auction has ended and cannot be changed.' using errcode = '22023';
    end if;
    if exists (select 1 from public.bids where auction_id = old.id) then
      raise exception 'An auction with bids cannot be changed or deleted.' using errcode = '22023';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.id is distinct from old.id or new.seller_id is distinct from old.seller_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Auction identity and creation time are immutable.' using errcode = '22023';
    end if;
  else
    if auth.uid() is null or auth.uid() is distinct from new.seller_id then
      raise exception 'The seller must be the signed-in user.' using errcode = '42501';
    end if;
    new.created_at := clock_timestamp();
  end if;

  if new.end_time <= clock_timestamp() then
    raise exception 'Auction end time must be in the future.' using errcode = '22023';
  end if;
  v_image_name := split_part(new.image_url, '/storage/v1/object/public/auction-images/', 2);
  v_origin := regexp_replace(v_issuer, '/auth/v1/?$', '');
  if v_origin is null or v_origin = v_issuer or new.image_url is distinct from
    v_origin || '/storage/v1/object/public/auction-images/' || v_image_name then
    raise exception 'Choose an uploaded auction image from this Supabase project.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auction-images/' || v_image_name, 0));
  perform 1 from storage.objects
    where bucket_id = 'auction-images' and name = v_image_name and owner_id = new.seller_id::text
    for key share;
  if not found then
    raise exception 'Choose an uploaded auction image that belongs to your account.' using errcode = '22023';
  end if;
  -- The image locks may have waited until either the existing or proposed deadline passed.
  if new.end_time <= clock_timestamp() or (tg_op = 'UPDATE' and old.end_time <= clock_timestamp()) then
    raise exception 'This auction has ended or its end time is no longer in the future.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists bidverse_guard_auction on public.auctions;
create trigger bidverse_guard_auction before insert or update or delete on public.auctions
  for each row execute function bidverse_private.guard_auction();

create or replace function public.place_bid(p_auction_id uuid, p_amount numeric)
returns public.bids language plpgsql security definer set search_path = '' as $$
declare
  v_bidder uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_highest numeric;
  v_minimum numeric;
  v_now timestamptz;
  v_bid public.bids%rowtype;
begin
  if v_bidder is null then
    raise exception 'Sign in to place a bid.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_amount <> trunc(p_amount, 2) then
    raise exception 'Bid amount must be positive, at most 1000000000, and have at most two decimal places.' using errcode = '22023';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'Auction not found.' using errcode = '22023';
  end if;
  -- Read wall-clock time after waiting for the lock, not the transaction start time.
  v_now := clock_timestamp();
  if v_auction.end_time <= v_now then
    raise exception 'This auction has ended. No more bids are accepted.' using errcode = '22023';
  end if;
  if v_bidder = v_auction.seller_id then
    raise exception 'You cannot bid on your own auction.' using errcode = '22023';
  end if;
  select amount into v_highest from public.bids where auction_id = p_auction_id and created_at < v_auction.end_time
    order by amount desc, created_at, id limit 1;
  v_minimum := case when v_highest is null then v_auction.starting_price else v_highest + 100 end;
  if p_amount < v_minimum then
    raise exception 'The minimum bid is ₹%. Refresh and try again.', v_minimum using errcode = '22023';
  end if;

  insert into public.bids(auction_id, bidder_id, amount, created_at)
    values (p_auction_id, v_bidder, p_amount, v_now) returning * into v_bid;
  -- INSERT can wait on foreign-key checks after the initial auction lock and deadline check.
  if v_auction.end_time <= clock_timestamp() then
    raise exception 'This auction has ended. No more bids are accepted.' using errcode = '22023';
  end if;
  return v_bid;
end;
$$;

-- These deliberate, read-only public projections reveal first names, never complete profiles.
create or replace view public.auction_summaries with (security_barrier = true) as
select a.*,
  top_bid.amount as highest_bid,
  (select count(*)::integer from public.bids b where b.auction_id = a.id and b.created_at < a.end_time) as bid_count,
  top_bid.bidder_id as highest_bidder_id,
  case when a.end_time <= statement_timestamp() then top_bid.bidder_id end as winner_id,
  (regexp_split_to_array(seller.full_name, '[[:space:]]+'))[1] as seller_name,
  case when a.end_time <= statement_timestamp() then (regexp_split_to_array(winner.full_name, '[[:space:]]+'))[1] end as winner_name
from public.auctions a
join public.profiles seller on seller.id = a.seller_id
left join lateral (
  select b.amount, b.bidder_id from public.bids b where b.auction_id = a.id and b.created_at < a.end_time
  order by b.amount desc, b.created_at, b.id limit 1
) top_bid on true
left join public.profiles winner on winner.id = top_bid.bidder_id;

create or replace view public.bid_history with (security_barrier = true) as
select b.*, (regexp_split_to_array(p.full_name, '[[:space:]]+'))[1] as bidder_name
from public.bids b join public.profiles p on p.id = b.bidder_id
join public.auctions a on a.id = b.auction_id where b.created_at < a.end_time;

revoke all on public.auction_summaries, public.bid_history from public, anon, authenticated;
grant select on public.auction_summaries, public.bid_history to anon, authenticated;
revoke all on all functions in schema bidverse_private from public, anon, authenticated;
grant execute on function bidverse_private.image_is_unreferenced(text) to authenticated;
revoke all on function public.place_bid(uuid, numeric) from public, anon, authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auctions') then
    alter publication supabase_realtime add table public.auctions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bids') then
    alter publication supabase_realtime add table public.bids;
  end if;
end;
$$;

commit;
