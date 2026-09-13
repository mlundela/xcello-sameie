# xcello-sameie

Accounting and property management for Norwegian housing cooperatives (sameier). SvelteKit, Drizzle, Postgres, better-auth.

## Development

```bash
cp .env.example .env
docker compose up -d db
bun install
bun run db:push
bun run dev
```

## Docker

```bash
docker build -t xcello-sameie .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/db \
  -e ORIGIN=https://your-domain \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  -e RESEND_API_KEY=... \
  -e MATRIKKEL_API_URL=... \
  xcello-sameie
```

The server listens on port 3000 and runs as the `node` user. `ORIGIN` must match the public URL, or form posts and auth callbacks are rejected. The image does not run migrations; apply the schema separately.

## Releases

Pushing a tag like `1.2.3` runs `.github/workflows/docker.yml`, which builds the image and pushes it to `ghcr.io/mlundela/xcello-sameie` tagged `1.2.3`, `1.2`, `1` and `latest`.

```bash
git tag 1.2.3
git push origin 1.2.3
```
