# BidVerse audit — 8 October 2026

The audit covered every React route, the Supabase client calls, table grants and RLS, Storage policies, the bid RPC, countdown/polling cleanup, authentication and the seller/buyer journey. Fixes stayed within the existing React/Supabase architecture. No credentials or hosted Supabase project were available.

## Defects found and fixed

| Finding | Fix and regression coverage |
| --- | --- |
| A bid could pass its initial deadline check, then finish delayed insertion after expiry. | Check the server clock again after insertion and roll back late work. SQL regression delays an AFTER INSERT trigger. |
| Listing creation or an update could wait on image locks until its deadline expired; an update could revive an auction that expired during the wait. | Recheck both the proposed deadline and original UPDATE deadline after acquiring image locks. SQL regressions simulate delays. |
| Administratively inserted bids stamped at/after the deadline could affect minimums, counts, history and winners. | Filter valid timestamps consistently in the RPC and public views; preserve raw records. SQL regressions cover boundary and future timestamps. |
| Home and Explore showed stale bids and listings indefinitely. | Refresh every 15 seconds, prevent overlapping requests, retain loaded data with an error message on failure, and clean up timers. |
| Homepage cards still said LIVE AUCTION after their countdown ended. | Expiry updates the card's status, price label and timer label. |
| Detail requests slower than the poll interval could be repeatedly invalidated, leaving the loading state indefinitely. | Finish the current request and queue one refresh. Route cleanup invalidates stale requests, including React StrictMode replay. |
| Malformed auction links produced a database syntax error instead of a missing-listing page. | Reject malformed UUIDs before querying. |
| Login rejected valid existing accounts whose passwords were shorter than the new-account minimum. | Apply the eight-character minimum only to registration; retain required-password validation for login. |
| Email confirmation lost the intended protected destination and expired confirmation links showed an ordinary login screen. | Preserve a validated internal destination in the confirmation URL; display callback errors. |
| A file claiming to be a JPEG could be uploaded without valid image bytes. | Decode the image before upload; retain MIME, nonzero size and 5 MB checks. |
| Seller listings showed only “Ended,” without the server's winner/no-bid/pending outcome. | Display the derived outcome in the seller dashboard. Personal bids use the same valid-history view as details. |
| Original canned browser responses ignored several query filters. | Respect ID, seller, bidder and deadline filters; add a SQL-backed journey so accepted bids and winners come from the real schema. |

## Query and security review

- Public listing reads use `auction_summaries`; details constrain the auction ID. Bid history constrains `auction_id`. Dashboard reads constrain seller/bidder identity and fetch associated auctions in batches. Paginated reads check and propagate errors.
- Public profiles remain inaccessible: authenticated users can read their own row and update only their own `full_name`. Signup creates profiles from Auth; application tables never store passwords.
- Auction insert/update/delete grants and policies use the authenticated seller. The guard requires an active listing without bids for changes/deletion and preserves identity/timestamps. Database tests exercise impersonation, cross-account changes and locked listings.
- Ordinary clients have no bid insert/update/delete grants. `place_bid` derives the bidder from `auth.uid()`, restricts execution to authenticated users, uses an empty search path, locks the auction, rejects self-bids, checks exact positive money and validates the current minimum.
- Auction updates/deletion and bids lock the same auction row. The highest-bid lookup is a separate statement in a volatile function, so PostgreSQL's normal READ COMMITTED execution obtains a fresh snapshot after waiting. This design was reviewed against [PostgreSQL function volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html); actual contention between independent connections remains untested.
- Public views deliberately use owner permissions to expose auction data and first-name labels while keeping full profiles private. They grant SELECT only. This may trigger Supabase's security-definer-view advisor; do not resolve that by exposing profiles.
- Uploaded objects must belong to the authenticated user's folder. Auction photos must reference an owned object on the trusted issuer origin. Overwrites are prohibited; referenced images cannot be removed. Advisory locks coordinate new references with deletion.
- No broken imports were found by the production build. No real payment processing is present or claimed.

## Verification

Final browser-suite results are recorded after execution in README. Unit/SQL tests and build have passed during this audit; the final browser run is pending while this report is being assembled.

The SQL-backed browser harness runs actual table queries, RLS, triggers, views and `place_bid` in PGlite. It simulates Auth/Storage HTTP and does not use a deployed Supabase service. PGlite serializes its one connection: delayed-trigger/lock simulations are regressions for deadline checks, not proof of simultaneous multi-connection transactions.

## Remaining setup and hosted verification

1. Create or select a Supabase project. Run the complete updated [`supabase/schema.sql`](../supabase/schema.sql) in SQL Editor as the administrator. Rerun it if the earlier version was applied. It preserves records in this schema, creates/backfills profiles, installs policies/functions/views, creates `auction-images`, and enrolls `auctions`/`bids` in Realtime.
2. Copy `.env.example` to `.env.local`; set `VITE_SUPABASE_URL` to the standard HTTPS project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to the browser-safe publishable key. Restart Vite. Never use a secret/service-role key.
3. Enable email/password Auth and choose email confirmation settings. Set Site URL to your app origin. Allow `/login` and `/login?redirect=**` for trusted development/preview origins that differ from Site URL. Verify actual confirmation delivery and return navigation.
4. Register a seller and two buyers in separate browser profiles. Create an auction with a real upload; check public browsing, ownership restrictions, valid/stale bids, expiry, winners, dashboards and logout. Follow the detailed journey in [`README.md`](../README.md).
5. Submit competing bids from independent sessions against hosted PostgreSQL, including submissions close to expiry. Verify committed amounts and timestamps, current minimum errors, seller-edit/delete races, and bids rejected after waiting past the deadline. These checks need real concurrent database connections.
6. Confirm hosted Storage rejects unauthorized upload/delete/overwrite and files outside its MIME/size limits. Confirm Realtime updates another browser without waiting for polling, then disconnect Realtime and check polling recovery.
7. Deploy to Vercel using the Vite preset, build `npm run build`, output `dist`, and the two environment variables. Set Supabase Site URL to the final HTTPS origin and retain only trusted redirect origins. Redeploy after environment changes; refresh auction/dashboard deep links and repeat the journey on mobile.

Offset pagination is not a shared database snapshot: concurrent edits can briefly cause display gaps/duplicates until refresh. The RPC remains authoritative. Payments, fulfillment, account-retention administration and production abuse controls remain outside this hackathon scope.
