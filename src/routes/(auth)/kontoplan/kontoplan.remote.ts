import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { requireAdmin, requireOrgId } from '$lib/server/tenant';
import { ledgerAccount, bankTransaction, voucherLine, matchingRule } from '$lib/schema';
import { and, eq, count } from 'drizzle-orm';
import { generateId } from 'better-auth';
import { DEFAULT_ACCOUNTS } from '$lib/server/default-accounts';
import { REQUIRED_ACCOUNT_CODES } from '$lib/accounts';

export const get_accounts = query(async () => {
	const orgId = requireOrgId();
	return db
		.select()
		.from(ledgerAccount)
		.where(eq(ledgerAccount.organizationId, orgId))
		.orderBy(ledgerAccount.code);
});

export const create_account = command(
	v.object({
		code: v.pipe(v.string(), v.minLength(1)),
		name: v.pipe(v.string(), v.minLength(1)),
		type: v.union([v.literal('INCOME'), v.literal('EXPENSE'), v.literal('LIABILITY'), v.literal('ASSET'), v.literal('EQUITY')])
	}),
	async ({ code, name, type }) => {
		const orgId = requireAdmin();
		// Codes are unique per sameie (la_org_code_idx)
		const created = await db
			.insert(ledgerAccount)
			.values({ id: generateId(), organizationId: orgId, code, name, type })
			.onConflictDoNothing()
			.returning({ id: ledgerAccount.id });
		if (created.length === 0) error(409, `Kontonummer ${code} finnes allerede`);
		await get_accounts().refresh();
	}
);

export const delete_account = command(
	v.object({ id: v.string() }),
	async ({ id }) => {
		const orgId = requireAdmin();
		const [account] = await db
			.select({ code: ledgerAccount.code })
			.from(ledgerAccount)
			.where(and(eq(ledgerAccount.id, id), eq(ledgerAccount.organizationId, orgId)));
		if (!account) error(404, 'Ikke funnet');
		if (REQUIRED_ACCOUNT_CODES.includes(account.code)) error(409, `Konto ${account.code} brukes av regnskapet og kan ikke slettes`);
		const usage = await Promise.all([
			db.select({ n: count() }).from(bankTransaction).where(eq(bankTransaction.ledgerAccountId, id)),
			db.select({ n: count() }).from(voucherLine).where(eq(voucherLine.ledgerAccountId, id)),
			db.select({ n: count() }).from(matchingRule).where(eq(matchingRule.ledgerAccountId, id))
		]);
		if (usage.some(([{ n }]) => n > 0)) error(409, 'Kontoen er i bruk og kan ikke slettes');
		await db.delete(ledgerAccount).where(and(eq(ledgerAccount.id, id), eq(ledgerAccount.organizationId, orgId)));
		await get_accounts().refresh();
	}
);

export const seed_default_accounts = command(v.object({}), async () => {
	const orgId = requireAdmin();
	const existing = await db
		.select({ used: count() })
		.from(ledgerAccount)
		.where(eq(ledgerAccount.organizationId, orgId));
	if (existing[0].used > 0) error(409, 'Kontoplan er allerede satt opp');
	await db.insert(ledgerAccount).values(
		DEFAULT_ACCOUNTS.map((a) => ({ id: generateId(), organizationId: orgId, ...a }))
	);
	await get_accounts().refresh();
});
