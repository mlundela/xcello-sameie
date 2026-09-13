# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **bun** (`packageManager: bun@1.2.9`).

```bash
docker compose up -d db          # Postgres 17 on :5432 (xcello/xcello/xcello)
bun install
bun run dev                      # Vite dev server on :5173; applies pending migrations on start
docker compose up --build        # app (Docker image, :3000) + db, reading .env

bun run check                    # svelte-kit sync + svelte-check — the only automated verification in this repo
bun run build && bun run preview

bun run db:generate              # drizzle-kit generate — new migration from src/lib/schema.ts
bun run db:studio
bun run db:seed                  # src/lib/server/seed.ts — demo users/orgs only, needs DATABASE_URL in env
```

There is **no test framework**. "Verification before done" means `bun run check` plus exercising the flow against the local DB (`psql`, `db:studio`, or the dev server). Don't claim tests pass; don't add a test runner unless asked.

`.env` needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `MATRIKKEL_API_URL`. `EMAIL_FROM` must be on a domain verified in Resend; `onboarding@resend.dev` only delivers to the Resend account owner, which is fine for local dev only. Note `MATRIKKEL_API_URL` points at a **separate external service not in compose.yml**; when it's unset or unreachable, org creation logs the failure and continues with the chart of accounts but no flats or owners.

## Domain

Accounting + property management for Norwegian housing cooperatives (*sameier*). `GLOSSARY.md` holds the Norwegian↔English vocabulary and the process flows (billing cycle, bank reconciliation, period close) — read it before touching domain logic. Its *Entity Reference* section describes a defunct Java model (`src/main/java/...`); trust `src/lib/schema.ts` for the actual tables.

- `docs/schema-technical-debt.md` — deliberately deferred data-model gaps (single loan field, sameiebrøk semantics, SAF-T export, split/manual vouchers, period locking). Check here before "fixing" a model weakness; it may be a known, accepted trade-off.
- `tasks/lessons.md` — corrections from the user, in Norwegian. Read at session start; append to it after any correction (see rule 2 below).
- **UI language is Norwegian.** Labels, error messages thrown from remote functions, and PDF report text are all Norwegian. Code identifiers and comments are mixed Norwegian/English; route segments are Norwegian (`transaksjoner`, `rapporter`, `kontoplan`, `husleie`, `matchingsregler`).

## Architecture

SvelteKit 2 / Svelte 5 (runes) · Drizzle ORM + postgres-js · better-auth 1.7 · Tailwind 4 + daisyUI 5 (`coffee` theme, 18px base) · pdfmake for reports · valibot for input schemas.

### Multi-tenancy runs through better-auth's organization plugin
One `organization` = one sameie. There is no separate tenant table: `session.activeOrganizationId` **is** the tenant context, set in the `databaseHooks.session.create.before` hook in `src/lib/server/auth.ts` (first membership wins). Every domain table carries `organizationId` and every query must filter on it.

better-auth only clears `activeOrganizationId` when users remove *themselves*; a member removed by an admin keeps it. `hooks.server.ts` therefore calls `ensureActiveMembership` (`src/lib/server/tenant.ts`) on every non-`/api/auth` request, which re-points a stale session at a remaining membership or `null`. Everything downstream can trust `locals.session`.

Route groups enforce access:
- `(public)` — login, signup, invite accept
- `(auth)` — requires session **and** an active org (else → `/organizations/new`); wraps everything in the sidebar layout
- `(auth-plain)` — requires session only, no active-org requirement (org creation). Anything that calls `requireOrgId()` belongs in `(auth)`, or users without an org get an error instead of the redirect.

`afterCreateOrganization` in `auth.ts` does the whole onboarding: fetches sections/owners from the Matrikkel API, then in one transaction always inserts `ledgerAccount` (from `DEFAULT_ACCOUNTS`) and, if Matrikkel returned data, `flat`, `owner`, `flatOwnership`, and one name-based `matchingRule` per owner. better-auth awaits the hook, so the data exists when `createOrganization` returns; no polling needed.

### Data access is remote functions, not load functions
`kit.experimental.remoteFunctions` is on. Each route owns a `<name>.remote.ts` exporting `query()`/`command()` from `$app/server`, with valibot schemas for args. Conventions to follow exactly:

- Resolve the tenant with `requireOrgId()` (or `requireSession()`) from `$lib/server/tenant`. Both read `locals.session` via `getRequestEvent()`, so they work in remote functions, `+server.ts` and `+page.server.ts` alike, and throw `error(401)`/`error(403)`. Don't call `auth.api.getSession` again; the hook already did.
- Pages call the query directly (`const data = get_x()`) and render it inside `{#await data}` with a daisyUI `loading-spinner`.
- Mutations use single-flight updates: `command({...}).updates(theQuery)`. Only call `query.refresh()` server-side (inside the command) when the refreshed query isn't the one the caller is awaiting.
- Expected failures use `error(status, 'norsk melding')` from `@sveltejs/kit`. A plain `throw new Error(...)` reaches the client as "Internal Error" (SvelteKit hides non-HttpError messages), so keep it for real bugs.
- On the client, remote functions reject with `HttpError`, which is **not** an `Error`. Show messages with `errorMessage(err)` from `$lib/notify.svelte`. A command fired without a `catch` still surfaces: the root layout turns unhandled rejections into a toast via `showError`.
- `+page.server.ts` / `+server.ts` exist only where remote functions can't reach: redirect-only loads (`/+page.server.ts` → `/dashboard` or `/login`; `transaksjoner/+page.server.ts` → oldest OPEN period, the same one the dashboard shows) and binary responses (PDF reports under `rapporter/[year]/`).

### Money is integer øre, everywhere
Columns are named `*Ore` / `*_ore` and are `integer`. Format with `formatKr(ore)` (or `formatKr(ore, { decimals: false })`) and parse user input with `krToOre(text)` from `$lib/money`, in the UI and the PDFs alike. Don't hand-roll `Math.floor(ore / 100)`: it rounds negative amounts away from zero. CSV amounts are parsed to kroner then `Math.round(amount * 100)`.

### The voucher (bilag) layer is the accounting source of truth
`src/lib/server/voucher.ts` is the **only** place vouchers are written. It's a hidden data layer: the UI still talks about bank transactions and one account/owner per transaction, but reports aggregate `voucher_line`, not `bank_transaction`.

- `createBankAutoVouchers` (batch; `createBankAutoVoucher` for one) — 2 lines each, one side always bank account `1920`; sets `bankTransaction.voucherId`. Pass all rows of an operation in one call: it does a fixed number of statements however many rows there are.
- Voucher numbers are reserved under a `pg_advisory_xact_lock` per (org, fiscal year), so every voucher writer takes a transaction (`Tx`), never bare `db`.
- `deleteBankAutoVoucher` — call it *before* re-categorising a transaction, then create the new voucher; every mutation path in `banktransaksjoner.remote.ts` does this inside one `db.transaction`.
- `createOpeningVoucher` / `readOpeningState` — opening balances are `source: 'OPENING'` vouchers. Writing one deletes and recreates the year's OPENING voucher, so read current state first and pass the parts you aren't changing.
- Invariants: `SUM(debitOre) === SUM(creditOre)` per voucher; `voucherNumber` sequential per `(organizationId, fiscalYear)`; fiscal year derives from the voucher date.

Ledger account **codes are hardcoded in logic** and looked up per org: `1920` bank, `1500` receivable from owners, `2050` equity, `2400` long-term debt, `2770` prepaid fellesutgifter, `3600` felleskostnader (income). Missing accounts throw `Mangler konto NNNN i kontoplanen` — a common failure after adding a table/feature against an org seeded before `DEFAULT_ACCOUNTS` changed.

### Bank CSV import
`banktransaksjoner.remote.ts` auto-detects four Norwegian bank formats (BN Bank, DNB, SpareBank 1, Sparebanken Vest) by sniffing the header's first field — deliberately ASCII-stable because the encoding may be Windows-1252 with garbled `æøå` (see `decodeBuffer`). Sample files live in `csv/` and `spv-*.csv`. Import rules: the CSV's year(s) must each have an **OPEN** `accounting_period` or the import is rejected; duplicates are skipped on `date|description|amountOre`; `matchingRule` patterns are matched case-insensitively (owner rules → `MATCHED` on account 3600, expense rules → `CATEGORIZED`), and matched rows get an auto-voucher immediately.

Transaction status is `UNMATCHED | MATCHED | CATEGORIZED`. Receipts (`attachment`) are stored base64 in Postgres; `receiptNotRequired` defaults true for inflows.

### Migrations run at server start
`drizzle/` holds drizzle-kit output only: a regenerated baseline (`0000_*.sql`) plus `meta/_journal.json`. `src/lib/server/migrate.ts` applies pending migrations before `hooks.server.ts` serves the first request, in `bun run dev` and in the Docker image (which copies `drizzle/`). To change the schema, edit `src/lib/schema.ts` and run `bun run db:generate`; don't hand-write SQL outside the journal, and don't use `drizzle-kit push`. A database created by `push` (or by an older migration set) fails the startup migrator with `relation "…" already exists`: drop the `public` and `drizzle` schemas, restart, then `bun run db:seed`. Per `tasks/lessons.md`: this project has no production data, so **do not write backfill scripts** — drop and recreate instead.

## Working agreements

### 1. Plan Mode Default
- Enter plan mode for ANY not-trivial task (3+ steps or architectural decisions)
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until the mistake rate drops
- Review lessons at session start for a project

### 3. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run `bun run check`, check logs, demonstrate correctness against the local DB

### 4. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes. Don't overengineer
- Challenge your own work before presenting it

### 5. Skills and subagents
- Skills live in `.claude/skills/` (`daisyui` for markup/styling, `jan-inge` for Norwegian accounting domain questions) — invoke them for the capability they cover
- Use subagents to keep the main context clean; one focused task per subagent

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards

## Project General Instructions
- Always use the latest versions of dependencies.
- Always prefer SvelteKit remote functions over load functions
- Always prefer the better-auth API over hand-written SQL whenever possible
- Minimize the amount of code generated.
- Keep `compose.yml` able to run every component the app needs.
- Update README.md after completing an implementation
