# BidVerse

**Discover. Bid. Win.**

**Problem:** Buyers and sellers need a secure platform for listing products and conducting online auctions.

**Solution:** One marketplace with public browsing, authenticated listings and bids, database-enforced rules, and clear auction outcomes.

BidVerse is a responsive auction marketplace built with React, Vite and Supabase. People can browse auctions, sign up, upload an item, place bids and see the winner after the deadline. PostgreSQL decides whether a bid is valid; changing browser JavaScript cannot bypass bidding rules.

The repository includes the frontend, database setup, local database tests and Vercel configuration. With no Supabase environment variables, the app shows clearly marked sample auctions so you can explore the interface. Sample listings never accept bids or save changes.

## What is included

- Home, searchable/filterable Explore, auction details, registration/login, Create Auction and a personal dashboard.
- Categories: Electronics, Fashion, Collectibles, Art, Accessories and Other.
- Image uploads to Supabase Storage; JPEG, PNG or WebP, up to 5 MB.
- Live bid updates, countdowns, bid history, seller listings, personal bids and wins.
- Accessible loading, empty and error states, mobile navigation and protected account routes.
- Server-enforced ownership, private full profiles, immutable bid history and an atomic bidding function.

This is a hackathon auction application. Payments, delivery, dispute resolution and identity verification are outside its scope.

## Stack and files

| Part | Technology / location |
| --- | --- |
| Frontend | React + Vite + React Router; `src/` |
| Authentication | Supabase Auth, email/password |
| Database | Supabase PostgreSQL; `supabase/schema.sql` |
| Files | Supabase Storage; `auction-images` bucket |
| Updates | Supabase Realtime with periodic refresh fallback |
| Hosting | Vercel; `vercel.json` handles SPA deep links |
| Local checks | Node test runner + PGlite; `tests/` |

## Local setup

1. Install Node.js 22.12 or newer (Node 24 LTS is suitable) and npm.
2. Open a terminal in the project folder and run:

   ```sh
   npm install
   ```

3. Create a project at [Supabase](https://supabase.com/dashboard). Wait until its database is ready.
4. In **SQL Editor**, create a new query. Paste the complete contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. Run it as the default project administrator, not as an application user.
5. The script creates the three app tables, constraints, indexes, auth trigger, policies, views, bid function, image bucket and Realtime publication entries. Do not separately create the bucket or add permissive policies. Running the same script again preserves existing records; it is not a migration system for unrelated older schemas.
6. In Supabase **Project Settings → API** (or the project's **Connect** panel), copy the project URL and browser-safe **publishable** key. Never use a secret/service-role key in frontend environment variables.
7. Copy `.env.example` to `.env.local` and fill in:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_SAFE_PUBLISHABLE_KEY
   ```

8. In Supabase **Authentication → URL Configuration**, set **Site URL** to `http://localhost:5173`. Registration confirmation returns to `/login?redirect=...` to preserve the intended page. For origins different from Site URL, add the exact confirmation URLs or a query pattern such as `http://localhost:5173/login?redirect=**` to **Redirect URLs**, plus `/login`. Use the same pattern with each trusted deployed/preview origin; avoid allowing arbitrary domains. See [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
9. In **Authentication → Providers → Email**, enable email/password registration. With **Confirm email** enabled, users must open the confirmation email before signing in. The app explains that registration can succeed before a session exists. For a supervised local demonstration, confirmation can be disabled in this setting; do not assume a project has it disabled.
10. Run:

    ```sh
    npm run dev
    ```

Open the local URL printed by Vite. Restart the dev server whenever environment variables change. If Vite chooses a different port, add that exact origin and `/login` URL to Supabase's configuration.

## Build and checks

```sh
npm test
npm run build
npm run preview
```

`npm test` executes the app checks and the actual `supabase/schema.sql` in PGlite, an embedded PostgreSQL runtime. The database harness supplies only the Supabase-managed Auth and Storage scaffolding, then switches between anonymous and authenticated database roles. It checks profile privacy, ownership, bid validation, spoofing rejection, deadlines, winner calculation, image policies and safe reruns.

PGlite uses one local connection: these tests do **not** prove multi-connection contention, hosted Auth emails, the Storage HTTP service's MIME/size enforcement, hosted Realtime delivery or production deployment. Complete the two-browser checklist below against your own Supabase project before presenting. No hosted project credentials are included in this repository.

The browser suite uses an installed Google Chrome by default:

```sh
npm run test:ui
```

If Chrome is unavailable, install Chromium and choose it (PowerShell):

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:ui
```

Browser tests start two isolated Vite servers on ports 5173 and 5174. They cover every route, browsing/search/filter/sort, sample read-only behavior, mobile layouts, session recovery, email callback errors, uploads/cleanup, catalog polling, slow responses and timer cleanup. Most use simulated Supabase HTTP responses to test the React integration.

`tests/browser/sql-flow.spec.js` additionally runs a complete seller → two buyers → expiry → winner journey with browser requests backed by the actual schema, queries, RPC and RLS in PGlite. Auth tokens/emails and Storage HTTP are still simulated. It checks persisted rows, rejected stale bids, private dashboards, deletion and no-bid outcomes; it does not establish hosted service or concurrent-connection behavior. Run only one Playwright command at a time because the suites share ports.

Desktop and mobile screenshots are saved in [`docs/screenshots/`](docs/screenshots/).

Checks executed on 8 October 2026:

| Command | Result |
| --- | --- |
| `npm test` | 24 passed: 10 PostgreSQL, 7 bidding/countdown, 4 paging, 3 formatting/filtering |
| `npm run test:ui -- --workers=2` | 10 passed in Google Chrome, including populated mobile dashboards and countdown expiry |
| `npm run build` | Passed; production output is in `dist/` |
| Desktop/mobile capture | 5 screenshots, no page errors or horizontal page overflow |

Public listing, history and dashboard reads fetch successive pages instead of silently stopping at Supabase's API row cap. These offset requests do not share a transaction snapshot: concurrent changes can briefly produce gaps/duplicates until the next refresh. Bidding and winner validation always happen in PostgreSQL independently of those display reads.

## Deploy to Vercel

1. Push the project to a Git repository and import it in [Vercel](https://vercel.com/new).
2. Choose the **Vite** preset. Build command: `npm run build`. Output directory: `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's environment variables before the deployment. They are compiled into the browser bundle and must contain only browser-safe credentials.
4. Deploy. `vercel.json` rewrites app routes to `index.html`, so opening `/auctions/...` or `/dashboard` directly works.
5. In Supabase, change **Site URL** to the final HTTPS domain. Keep `/login` and `/login?redirect=**` entries for trusted localhost or preview origins that differ from Site URL. Add individual preview origins if testing authentication from previews.
6. Redeploy after changing Vite environment variables. Open the deployed site, refresh a deep link and perform the manual journey below.

## Bidding algorithm

The browser calls `place_bid(p_auction_id, p_amount)`; it never writes directly to `bids`.

1. PostgreSQL derives the bidder from `auth.uid()`. The caller cannot choose another bidder's ID.
2. It locks the auction row with `SELECT … FOR UPDATE`. Competing bids and seller edits/deletions wait on the same row.
3. After acquiring the lock, it checks the database clock, the auction's existence and that the bidder is not its seller.
4. Amounts must be finite, positive, at most 1,000,000,000 and have at most two decimal places. The database rejects extra precision rather than silently rounding it.
5. The first bid must meet the starting price. Every later bid must meet the current highest valid bid plus ₹100.
6. It inserts the bid with a server timestamp, checks the deadline again after insertion and returns the row in the same transaction. Delays during insertion cannot save an already-expired bid; a failure rolls the transaction back.

Only bids timestamped strictly before the deadline affect the minimum, summaries, history and winners. When the end time passes, `auction_summaries` identifies the highest valid bidder as the winner. An auction with no bids has no winner. No background worker is needed, and browser clock changes do not change database acceptance. The app refreshes expired listings to display this derived result.

## Database and security notes

- `profiles`: authenticated people can read and edit only their own profile. The signup trigger creates profiles, and setup backfills existing Auth users. Full names are not publicly readable.
- `auctions`: public reads; authenticated sellers create their own listings. Only their owner can edit/delete an active listing before its first bid. Deadline validation repeats after image locks, so a delayed operation cannot revive an expired auction. Identity and creation time cannot be changed.
- `bids`: public reads; no client insert/update/delete grants. Only the authenticated bid RPC can insert.
- `auction_summaries` and `bid_history`: explicitly selected public fields, including only the first token of names. These views intentionally run with their owner's read permissions to display names without granting public profile access. They grant **SELECT only**. Supabase's advisor may flag a definer view; review these limited projections rather than exposing `profiles` or changing them to an invoker view that hides display names.
- Security-definer functions use an empty search path and fully qualified objects. Internal helpers live in an unexposed private schema; only the bid RPC is exposed to authenticated clients.
- The image bucket is public because auction photos are public. Uploads must use the signed-in user's folder and owner ID. Overwrites are disabled. Owners can delete only images that no listing references. Listing deletion preserves bid history by being unavailable after bidding starts.
- Use the standard HTTPS project URL for `VITE_SUPABASE_URL`. Image URLs must match the trusted Auth JWT issuer origin and an owned uploaded object. A custom Storage domain with a different issuer requires a deliberate schema adjustment.
- Supabase's service-role/secret key bypasses RLS. Keep it out of this project and out of browser code.
- Existing auction/bid history can prevent deletion of a referenced Auth account. Account removal and data retention need an explicit administrative workflow if this grows beyond a demonstration.

The implementation follows Supabase's official guidance on [function permissions and search paths](https://supabase.com/docs/guides/database/functions), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership).

## Manual two-browser journey

Use two separate browser profiles or one normal and one private window, so sessions do not overwrite each other.

1. Register seller **A** and buyer **B** with separate email addresses; confirm emails if enabled. Check that both can sign in and sign out.
2. As A, create an auction with a valid image, a starting price such as ₹500 and a future deadline. Verify it appears on Explore and A's dashboard. Check an invalid image type, an oversized image and a past deadline are rejected.
3. As B, open the detail page. Try ₹499.99, then bid ₹500. The first fails and the second is saved. Verify history identifies B and A's window refreshes without a reload.
4. As A, verify self-bidding is rejected and editing/deleting the auction after B's bid is unavailable. Try the same actions through the browser's Supabase client: the database must still reject them.
5. As B, try ₹599.99 and then ₹600. Verify the minimum changes to ₹700 after success. In a third buyer session, submit competing bids near the same time; verify the stored history increases by at least ₹100 and stale bids receive an error.
6. Let a short test auction expire. Verify the countdown stops, later bids fail, B appears as winner and B's dashboard shows the win. Check a separate expired auction with no bids shows no winner.
7. Create another active auction without bids and delete it as A after confirming the dialog. Verify B cannot delete A's listing or its referenced image.
8. Visit Explore and details signed out; browsing works, bidding redirects to login. Refresh `/dashboard` and an auction deep link on the deployed site. Check mobile navigation and keyboard focus.
9. Disconnect the network or temporarily use an invalid browser-safe key. Verify errors are visible and no upload, listing or bid is reported as saved.

## Suggested four-person team split

| Person | Responsibility | Demo ownership |
| --- | --- | --- |
| Member 1 — Frontend Design | App shell, visual design, home/explore and responsive layout | Explain navigation and browsing |
| Member 2 — Supabase and Authentication | Supabase setup, database policies, Auth and profile/session handling | Explain sign-in and access control |
| Member 3 — Auction and Bidding System | Auction creation/detail, uploads, countdown, bid function, history and live updates | Demonstrate bidding from two browsers |
| Member 4 — Seller Dashboard and Integration | Seller listings, personal bids/wins, app integration, tests and deployment | Show the dashboard and deployment journey |

## Short presentation walkthrough

Seller logs in → creates a short auction → Buyer A bids the starting price → Buyer B bids at least ₹100 higher → the auction ends → Buyer B appears as the winner and sees the auction in My wins. Use three separate browser profiles for these identities and explain that this MVP collects no payments.

## Project structure

```text
bidverse/
├── public/                  # Local product images, fonts and icon
├── src/
│   ├── components/          # Navigation, cards, bid form/history, countdown
│   ├── context/             # Auth session and toast notifications
│   ├── data/                # Clearly marked, read-only sample auctions
│   ├── lib/                 # Supabase client, formatting and database reads
│   ├── pages/               # Home, Explore, Details, Create, Dashboard, Login
│   ├── App.jsx              # Routes and shared shell
│   ├── App.css
│   ├── index.css
│   └── main.jsx
├── supabase/schema.sql      # Complete SQL Editor commands
├── tests/                   # Node/SQL checks and Playwright browser tests
├── docs/screenshots/        # Desktop and mobile previews
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── playwright.config.js
├── vercel.json
├── vite.config.js
└── README.md
```

## Asset credits

The local preview photographs come from Unsplash: [camera](https://images.unsplash.com/photo-1516035069371-29a1b244cc32), [headphones](https://images.unsplash.com/photo-1546435770-a3e426bf472b), [sneakers](https://images.unsplash.com/photo-1600185365483-26d7a4cc7519), [watch](https://images.unsplash.com/photo-1524805444758-089113d48a6d), [art](https://images.unsplash.com/photo-1541961017774-22349e4a1262), and [vintage camera](https://images.unsplash.com/photo-1452780212940-6f5c0d14d848). These illustrate sample products; a real seller supplies their own photograph. DM Sans and Manrope are self-hosted with their OFL licenses in `public/fonts/`. Icons use Lucide React.

## Judge questions

**How do you stop two bids overwriting each other?** Bids are append-only, and the bid transaction locks the auction before reading its current highest bid. The second transaction checks the newly committed highest amount after waiting.

**Can a user bypass validation with DevTools?** Client validation improves usability; database constraints, grants, RLS and the RPC enforce the rules independently. The caller's authenticated identity determines the bidder.

**What picks the winner?** A database view returns the highest bidder only after the server deadline. There is no winner without a bid and no scheduler to forget to run.

**What happens if Realtime disconnects?** The app refetches periodically and after a bid. PostgreSQL remains the source of truth, and a stale minimum is rejected with the current required amount.

**Why Supabase?** It provides PostgreSQL, authentication, storage and subscriptions without a separate application server, while leaving the sensitive auction logic in one transaction.

**What would you add for production?** Payment and fulfillment workflows, abuse controls and rate limits, moderation, account retention/deletion operations, monitoring, and hosted concurrency/security checks. Those are not claimed as implemented here.
