import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '$lib/schema';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';

if (!building && !env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(env.DATABASE_URL!);

// adapter-node emits this after the HTTP server closes; idle pool connections would otherwise keep the process alive
process.on('sveltekit:shutdown', () => client.end());

export const db = drizzle({ client, schema });
