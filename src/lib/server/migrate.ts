import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { building } from '$app/environment';
import { db } from './db';

// Applies any pending migrations at server start, before the first request is
// served. hooks.server.ts imports this first, so the import's top-level await
// is what the rest of the module graph waits on.
//
// The migrator lives in drizzle-orm, which is a production dependency --
// drizzle-kit is NOT needed at runtime and stays a devDependency. What IS
// needed is the drizzle/ folder itself (the .sql files plus meta/_journal.json),
// which the Dockerfile copies into the runtime stage. Without it this throws at
// startup rather than silently serving a schema-less database, which is the
// failure this file exists to prevent: the app used to come up healthy and
// answer 200 on / with no tables at all, and only blew up on first signup with
// `relation "user" does not exist`.
//
// Relative to the working directory: /app in the container, the repo root in
// dev. Both resolve to the folder next to package.json.
if (!building) {
	await migrate(db, { migrationsFolder: 'drizzle' });
}
