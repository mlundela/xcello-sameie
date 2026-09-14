# xcello-sameie

Accounting and property management for Norwegian housing cooperatives (sameier): bank statement import and reconciliation, felleskostnader per owner, receipts, and year-end reports (resultatregnskap and balanse) as PDF. SvelteKit, Drizzle, Postgres, better-auth.

## Roles

Each sameie has owners, administrators and members. Owners and administrators can do everything. Members can see everything (dashboard, transactions, reports, chart of accounts, rules) and upload or delete receipts, but can't import statements, categorise transactions, or change accounts, rules, rent or opening balances.

## Development

```bash
cp .env.example .env        # fill in secrets; see below
docker compose up -d db
bun install
bun run dev                 # http://localhost:5173, applies pending migrations on start
bun run db:seed             # optional, on an empty database: two demo sameier with a year and a half of data
```

`bun run check` (svelte-check) is the automated verification and runs in CI on every pull request.

### Environment

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ORIGIN` | Public URL of the app; auth callbacks and form posts are rejected otherwise |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `RESEND_API_KEY` | Email delivery |
| `EMAIL_FROM` | Sender on a domain verified in Resend. `onboarding@resend.dev` only delivers to the Resend account owner, so use it for local development only |
| `MATRIKKEL_API_URL` | External service with sections and owners per address. Optional: without it, a new sameie gets a chart of accounts but no flats or owners |

### Database changes

Edit `src/lib/schema.ts`, then `bun run db:generate`. The new migration in `drizzle/` is applied the next time the server starts. If a local database was created some other way (for example with `drizzle-kit push`), startup fails with `relation "…" already exists`; drop the `public` and `drizzle` schemas and start again.

## Docker

Run the production image together with Postgres:

```bash
docker compose up --build   # http://localhost:3000, secrets from .env
```

Or on its own:

```bash
docker build -t xcello-sameie .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/db \
  -e ORIGIN=https://your-domain \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  -e RESEND_API_KEY=... \
  -e EMAIL_FROM="Xcello Sameie <noreply@your-verified-domain>" \
  -e MATRIKKEL_API_URL=... \
  xcello-sameie
```

The server listens on port 3000 and runs as the `node` user. Pending migrations run at startup, before the first request is served.

## Releases

Pushing a tag like `1.2.3` runs `.github/workflows/docker.yml`, which builds the image and pushes it to `ghcr.io/mlundela/xcello-sameie` tagged `1.2.3`, `1.2`, `1` and `latest`.

```bash
git tag 1.2.3
git push origin 1.2.3
```
