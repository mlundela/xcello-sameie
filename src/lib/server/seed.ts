import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import * as schema from '../schema.js';

const { user, account, organization, member } = schema;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(process.env.DATABASE_URL);
const db = drizzle({ client, schema });

const now = new Date();

const adminId = crypto.randomUUID();
const memberId = crypto.randomUUID();
const acmeId = crypto.randomUUID();
const globexId = crypto.randomUUID();

// Users
await db
	.insert(user)
	.values([
		{ id: adminId, name: 'Admin User', email: 'admin@example.com', emailVerified: true, createdAt: now, updatedAt: now },
		{ id: memberId, name: 'Normal User', email: 'user@example.com', emailVerified: true, createdAt: now, updatedAt: now }
	])
	.onConflictDoNothing();

// Accounts (email/password credentials)
await db
	.insert(account)
	.values([
		{ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('password123'), createdAt: now, updatedAt: now },
		{ id: crypto.randomUUID(), userId: memberId, accountId: memberId, providerId: 'credential', password: await hashPassword('password123'), createdAt: now, updatedAt: now }
	])
	.onConflictDoNothing();

// Organizations
await db
	.insert(organization)
	.values([
		{ id: acmeId, name: 'Acme Corp', slug: 'acme', createdAt: now },
		{ id: globexId, name: 'Globex Inc', slug: 'globex', createdAt: now }
	])
	.onConflictDoNothing();

// Members
await db
	.insert(member)
	.values([
		{ id: crypto.randomUUID(), userId: adminId, organizationId: acmeId, role: 'admin', createdAt: now },
		{ id: crypto.randomUUID(), userId: adminId, organizationId: globexId, role: 'admin', createdAt: now },
		{ id: crypto.randomUUID(), userId: memberId, organizationId: acmeId, role: 'member', createdAt: now }
	])
	.onConflictDoNothing();

console.log('Seeded:');
console.log('  admin@example.com  → Acme Corp (admin), Globex Inc (admin)');
console.log('  user@example.com   → Acme Corp (member)');

await client.end();
