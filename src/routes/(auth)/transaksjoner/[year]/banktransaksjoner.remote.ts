import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId } from '$lib/server/tenant';
import {
	bankTransaction,
	bankStatement,
	matchingRule,
	owner,
	ledgerAccount,
	accountingPeriod,
	attachment
} from '$lib/schema';
import { eq, and, sql, inArray, ilike, gt, gte, lt, lte, asc, desc } from 'drizzle-orm';
import { generateId } from 'better-auth';
import { createBankAutoVoucher, createBankAutoVouchers, deleteBankAutoVoucher } from '$lib/server/voucher';
import { inYear } from '$lib/server/period';
import { findRule, upsertRule } from '$lib/server/matching';
import { decodeBuffer, detectAndParse } from '$lib/server/csv';

export const get_transactions = query(
	v.object({
		year: v.optional(v.pipe(v.number(), v.integer())),
		type: v.optional(v.picklist(['income', 'expense']))
	}),
	async ({ year, type }) => {
		const orgId = requireOrgId();
		const rows = await db
			.select({
				id: bankTransaction.id,
				date: bankTransaction.date,
				description: bankTransaction.description,
				userDescription: bankTransaction.userDescription,
				amountOre: bankTransaction.amountOre,
				status: bankTransaction.status,
				matchedOwnerId: bankTransaction.matchedOwnerId,
				ownerName: owner.name,
				ledgerAccountId: bankTransaction.ledgerAccountId,
				ledgerAccountName: ledgerAccount.name,
				ledgerAccountCode: ledgerAccount.code,
				bankStatementId: bankTransaction.bankStatementId,
				fileName: bankStatement.fileName,
				attachmentCount: sql<number>`(select count(*) from attachment where bank_transaction_id = ${bankTransaction.id})`.mapWith(Number),
				receiptNotRequired: bankTransaction.receiptNotRequired
			})
			.from(bankTransaction)
			.leftJoin(owner, eq(owner.id, bankTransaction.matchedOwnerId))
			.leftJoin(ledgerAccount, eq(ledgerAccount.id, bankTransaction.ledgerAccountId))
			.innerJoin(bankStatement, eq(bankStatement.id, bankTransaction.bankStatementId))
			.where(
				and(
					eq(bankTransaction.organizationId, orgId),
					year ? inYear(bankTransaction.date, year) : undefined,
					type === 'income' ? gt(bankTransaction.amountOre, 0) : type === 'expense' ? lt(bankTransaction.amountOre, 0) : undefined
				)
			)
			.orderBy(asc(bankTransaction.date), asc(bankTransaction.description));
		return rows;
	}
);

export const get_transaction = query(
	v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
	async ({ id }) => {
		const orgId = requireOrgId();
		const [row] = await db
			.select({
				id: bankTransaction.id,
				date: bankTransaction.date,
				description: bankTransaction.description,
				userDescription: bankTransaction.userDescription,
				amountOre: bankTransaction.amountOre,
				status: bankTransaction.status,
				matchedOwnerId: bankTransaction.matchedOwnerId,
				ownerName: owner.name,
				ledgerAccountId: bankTransaction.ledgerAccountId,
				ledgerAccountName: ledgerAccount.name,
				ledgerAccountCode: ledgerAccount.code,
				fileName: bankStatement.fileName,
				receiptNotRequired: bankTransaction.receiptNotRequired
			})
			.from(bankTransaction)
			.leftJoin(owner, eq(owner.id, bankTransaction.matchedOwnerId))
			.leftJoin(ledgerAccount, eq(ledgerAccount.id, bankTransaction.ledgerAccountId))
			.innerJoin(bankStatement, eq(bankStatement.id, bankTransaction.bankStatementId))
			.where(and(eq(bankTransaction.id, id), eq(bankTransaction.organizationId, orgId)))
			.limit(1);
		if (!row) error(404, 'Transaksjon ikke funnet');
		return row;
	}
);

export const get_statements = query(async () => {
	const orgId = requireOrgId();
	return db
		.select()
		.from(bankStatement)
		.where(eq(bankStatement.organizationId, orgId))
		.orderBy(bankStatement.importedAt);
});

// All periods, so closed years stay viewable; import_csv still requires an OPEN one
export const get_periods = query(async () => {
	const orgId = requireOrgId();
	return db
		.select()
		.from(accountingPeriod)
		.where(eq(accountingPeriod.organizationId, orgId))
		.orderBy(accountingPeriod.year);
});

export const import_csv = command(
	v.object({
		csvBase64: v.pipe(v.string(), v.minLength(1)),
		fileName: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ csvBase64, fileName }) => {
		const orgId = requireAdmin();

		const csvText = decodeBuffer(Buffer.from(csvBase64, 'base64'));
		const parsed = detectAndParse(csvText);

		if (parsed.length === 0) error(400, 'Filen inneholder ingen transaksjoner');

		// Validate that each year in the CSV has an OPEN accounting period
		const years = [...new Set(parsed.map((r) => parseInt(r.date.substring(0, 4))))];
		const openPeriods = await db
			.select({ year: accountingPeriod.year })
			.from(accountingPeriod)
			.where(
				and(
					eq(accountingPeriod.organizationId, orgId),
					eq(accountingPeriod.status, 'OPEN'),
					inArray(accountingPeriod.year, years)
				)
			);
		const openYears = new Set(openPeriods.map((p) => p.year));
		const missingYears = years.filter((y) => !openYears.has(y));
		if (missingYears.length > 0) {
			error(400, `Ingen åpen regnskapsperiode for år: ${missingYears.join(', ')}`);
		}

		// Existing transactions in the file's date range, to detect duplicates (ISO dates sort as strings)
		const dates = parsed.map((r) => r.date).sort();
		const existing = await db
			.select({
				date: bankTransaction.date,
				description: bankTransaction.description,
				amountOre: bankTransaction.amountOre
			})
			.from(bankTransaction)
			.where(
				and(
					eq(bankTransaction.organizationId, orgId),
					gte(bankTransaction.date, dates[0]),
					lte(bankTransaction.date, dates[dates.length - 1])
				)
			);

		const existingKeys = new Set(
			existing.map((r) => `${r.date}|${r.description}|${r.amountOre}`)
		);

		// Fetch matching rules
		const rules = await db
			.select({ pattern: matchingRule.pattern, ownerId: matchingRule.ownerId, ledgerAccountId: matchingRule.ledgerAccountId, receiptNotRequired: matchingRule.receiptNotRequired, userDescription: matchingRule.userDescription })
			.from(matchingRule)
			.where(eq(matchingRule.organizationId, orgId));

		const account3600Id = await get3600AccountId(orgId);

		const toInsert: Array<{
			id: string;
			organizationId: string;
			bankStatementId: string;
			date: string;
			description: string;
			userDescription: string | null;
			amountOre: number;
			matchedOwnerId: string | null;
			ledgerAccountId: string | null;
			status: string;
			receiptNotRequired: boolean;
		}> = [];
		let skippedCount = 0;

		for (const row of parsed) {
			const key = `${row.date}|${row.description}|${row.amountOre}`;
			if (existingKeys.has(key)) {
				skippedCount++;
				continue;
			}

			let matchedOwnerId: string | null = null;
			let ledgerAccountId: string | null = null;
			let status = 'UNMATCHED';
			let receiptNotRequired = row.amountOre > 0;
			let userDescription: string | null = null;

			// Longest applicable pattern wins; account rules only apply to outgoing payments
			const match = findRule(rules, row.description, row.amountOre);

			if (match) {
				if (match.ownerId) {
					// Owner rules match both income (innbetaling) and refunds (tilbakebetaling)
					matchedOwnerId = match.ownerId;
					ledgerAccountId = account3600Id;
					status = 'MATCHED';
				} else if (match.ledgerAccountId) {
					ledgerAccountId = match.ledgerAccountId;
					status = 'CATEGORIZED';
				}
				if (match.receiptNotRequired) receiptNotRequired = true;
				if (match.userDescription) userDescription = match.userDescription;
			}

			toInsert.push({
				id: generateId(),
				organizationId: orgId,
				bankStatementId: '', // filled after statement insert
				date: row.date,
				description: row.description,
				userDescription,
				amountOre: row.amountOre,
				matchedOwnerId,
				ledgerAccountId,
				status,
				receiptNotRequired
			});
		}

		await db.transaction(async (tx) => {
			const [stmt] = await tx
				.insert(bankStatement)
				.values({
					id: generateId(),
					organizationId: orgId,
					fileName,
					content: csvText,
					importedAt: new Date(),
					rowCount: toInsert.length,
					skippedCount
				})
				.returning({ id: bankStatement.id });

			if (toInsert.length > 0) {
				await tx.insert(bankTransaction).values(
					toInsert.map((r) => ({ ...r, bankStatementId: stmt.id }))
				);
				await createBankAutoVouchers(
					tx,
					orgId,
					toInsert.flatMap((r) =>
						r.status === 'UNMATCHED' || !r.ledgerAccountId
							? []
							: [{
									bankTransactionId: r.id,
									date: r.date,
									amountOre: r.amountOre,
									counterAccountId: r.ledgerAccountId,
									ownerId: r.matchedOwnerId,
									description: r.userDescription ?? r.description
								}]
					)
				);
			}
		});

		await get_statements().refresh();

		return { imported: toInsert.length, skipped: skippedCount };
	}
);

/**
 * ILIKE pattern for "description contains `pattern`", matching the case-insensitive substring check
 * import_csv uses. Escapes LIKE metacharacters so a rule like "100%" doesn't act as a wildcard.
 */
function containsPattern(pattern: string): string {
	return `%${pattern.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The org's unmatched transactions that a just-saved rule would win at import (see findRule),
 * so creating a rule now and importing later give the same result: a shorter new rule doesn't
 * take transactions a longer existing rule applies to.
 */
async function unmatchedWonBy(tx: Tx, orgId: string, pattern: string) {
	const [rules, candidates] = await Promise.all([
		tx
			.select({ pattern: matchingRule.pattern, ownerId: matchingRule.ownerId, ledgerAccountId: matchingRule.ledgerAccountId, receiptNotRequired: matchingRule.receiptNotRequired, userDescription: matchingRule.userDescription })
			.from(matchingRule)
			.where(eq(matchingRule.organizationId, orgId)),
		tx
			.select({ id: bankTransaction.id, date: bankTransaction.date, amountOre: bankTransaction.amountOre, description: bankTransaction.description, userDescription: bankTransaction.userDescription })
			.from(bankTransaction)
			.where(and(eq(bankTransaction.organizationId, orgId), eq(bankTransaction.status, 'UNMATCHED'), ilike(bankTransaction.description, containsPattern(pattern))))
	]);
	return candidates.filter((c) => findRule(rules, c.description, c.amountOre)?.pattern.toLowerCase() === pattern.toLowerCase());
}

async function get3600AccountId(orgId: string): Promise<string | null> {
	const [account] = await db
		.select({ id: ledgerAccount.id })
		.from(ledgerAccount)
		.where(and(eq(ledgerAccount.organizationId, orgId), eq(ledgerAccount.code, '3600')))
		.limit(1);
	return account?.id ?? null;
}

export const match_transaction = command(
	v.object({ transactionId: v.string(), ownerId: v.string() }),
	async ({ transactionId, ownerId }) => {
		const orgId = requireAdmin();
		await assertInOrg(owner, [ownerId], orgId);
		const ledgerAccountId = await get3600AccountId(orgId);
		if (!ledgerAccountId) error(409, 'Mangler konto 3600 i kontoplanen');
		await db.transaction(async (tx) => {
			await deleteBankAutoVoucher(tx, transactionId);
			const [row] = await tx
				.select({
					date: bankTransaction.date,
					amountOre: bankTransaction.amountOre,
					description: bankTransaction.description,
					userDescription: bankTransaction.userDescription,
					organizationId: bankTransaction.organizationId
				})
				.from(bankTransaction)
				.where(eq(bankTransaction.id, transactionId))
				.limit(1);
			if (!row || row.organizationId !== orgId) error(404, 'Transaksjon ikke funnet');
			await tx
				.update(bankTransaction)
				.set({ matchedOwnerId: ownerId, ledgerAccountId, status: 'MATCHED' })
				.where(eq(bankTransaction.id, transactionId));
			await createBankAutoVoucher(tx, {
				organizationId: orgId,
				bankTransactionId: transactionId,
				date: row.date,
				amountOre: row.amountOre,
				counterAccountId: ledgerAccountId,
				ownerId,
				description: row.userDescription ?? row.description
			});
		});
		// Client refreshes via .updates()
	}
);

export const create_rule_and_apply = command(
	v.object({
		pattern: v.pipe(v.string(), v.minLength(1)),
		ownerId: v.pipe(v.string(), v.minLength(1)),
		receiptNotRequired: v.optional(v.boolean(), false),
		userDescription: v.optional(v.string())
	}),
	async ({ pattern, ownerId, receiptNotRequired, userDescription }) => {
		const orgId = requireAdmin();
		await assertInOrg(owner, [ownerId], orgId);
		const ledgerAccountId = await get3600AccountId(orgId);
		if (!ledgerAccountId) error(409, 'Mangler konto 3600 i kontoplanen');
		const matched = await db.transaction(async (tx) => {
			await upsertRule(tx, orgId, { pattern, ownerId, ledgerAccountId: null, receiptNotRequired, userDescription: userDescription ?? null });
			const rows = await unmatchedWonBy(tx, orgId, pattern);
			if (rows.length === 0) return 0;
			await tx
				.update(bankTransaction)
				.set({
					matchedOwnerId: ownerId,
					ledgerAccountId,
					status: 'MATCHED',
					...(receiptNotRequired ? { receiptNotRequired: true } : {}),
					...(userDescription ? { userDescription } : {})
				})
				.where(inArray(bankTransaction.id, rows.map((r) => r.id)));
			await createBankAutoVouchers(
				tx,
				orgId,
				rows.map((row) => ({
					bankTransactionId: row.id,
					date: row.date,
					amountOre: row.amountOre,
					counterAccountId: ledgerAccountId,
					ownerId,
					description: userDescription || row.userDescription || row.description
				}))
			);
			return rows.length;
		});
		return { matched };
	}
);

export const create_expense_rule_and_apply = command(
	v.object({
		pattern: v.pipe(v.string(), v.minLength(1)),
		ledgerAccountId: v.pipe(v.string(), v.minLength(1)),
		receiptNotRequired: v.optional(v.boolean(), false),
		userDescription: v.optional(v.string())
	}),
	async ({ pattern, ledgerAccountId, receiptNotRequired, userDescription }) => {
		const orgId = requireAdmin();
		await assertInOrg(ledgerAccount, [ledgerAccountId], orgId);
		const categorized = await db.transaction(async (tx) => {
			await upsertRule(tx, orgId, { pattern, ownerId: null, ledgerAccountId, receiptNotRequired, userDescription: userDescription ?? null });
			// findRule only lets account rules win outgoing payments
			const rows = await unmatchedWonBy(tx, orgId, pattern);
			if (rows.length === 0) return 0;
			await tx
				.update(bankTransaction)
				.set({
					ledgerAccountId,
					status: 'CATEGORIZED',
					...(receiptNotRequired ? { receiptNotRequired: true } : {}),
					...(userDescription ? { userDescription } : {})
				})
				.where(inArray(bankTransaction.id, rows.map((r) => r.id)));
			await createBankAutoVouchers(
				tx,
				orgId,
				rows.map((row) => ({
					bankTransactionId: row.id,
					date: row.date,
					amountOre: row.amountOre,
					counterAccountId: ledgerAccountId,
					description: userDescription || row.userDescription || row.description
				}))
			);
			return rows.length;
		});
		return { categorized };
	}
);

export const unmatch_transaction = command(
	v.object({ transactionId: v.string() }),
	async ({ transactionId }) => {
		const orgId = requireAdmin();
		await db.transaction(async (tx) => {
			const updated = await tx
				.update(bankTransaction)
				.set({ matchedOwnerId: null, ledgerAccountId: null, status: 'UNMATCHED' })
				.where(and(eq(bankTransaction.id, transactionId), eq(bankTransaction.organizationId, orgId)))
				.returning({ id: bankTransaction.id });
			if (updated.length === 0) error(404, 'Transaksjon ikke funnet');
			await deleteBankAutoVoucher(tx, transactionId);
		});
		// Client refreshes via .updates()
	}
);

export const categorize_transaction = command(
	v.object({ transactionId: v.string(), ledgerAccountId: v.string() }),
	async ({ transactionId, ledgerAccountId }) => {
		const orgId = requireAdmin();
		await assertInOrg(ledgerAccount, [ledgerAccountId], orgId);
		await db.transaction(async (tx) => {
			await deleteBankAutoVoucher(tx, transactionId);
			const [row] = await tx
				.select({
					date: bankTransaction.date,
					amountOre: bankTransaction.amountOre,
					description: bankTransaction.description,
					userDescription: bankTransaction.userDescription,
					organizationId: bankTransaction.organizationId
				})
				.from(bankTransaction)
				.where(eq(bankTransaction.id, transactionId))
				.limit(1);
			if (!row || row.organizationId !== orgId) error(404, 'Transaksjon ikke funnet');
			await tx
				.update(bankTransaction)
				.set({ ledgerAccountId, matchedOwnerId: null, status: 'CATEGORIZED' })
				.where(eq(bankTransaction.id, transactionId));
			await createBankAutoVoucher(tx, {
				organizationId: orgId,
				bankTransactionId: transactionId,
				date: row.date,
				amountOre: row.amountOre,
				counterAccountId: ledgerAccountId,
				description: row.userDescription ?? row.description
			});
		});
		// Client refreshes via .updates()
	}
);

export const update_description = command(
	v.object({ transactionId: v.string(), userDescription: v.nullable(v.string()) }),
	async ({ transactionId, userDescription }) => {
		const orgId = requireAdmin();
		await db
			.update(bankTransaction)
			.set({ userDescription })
			.where(and(eq(bankTransaction.id, transactionId), eq(bankTransaction.organizationId, orgId)));
	}
);

export const get_attachments = query(
	v.object({ transactionId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ transactionId }) => {
		const orgId = requireOrgId();
		return db
			.select({
				id: attachment.id,
				fileName: attachment.fileName,
				mimeType: attachment.mimeType,
				// No `content`: files are up to 10 MB each. The page links to /vedlegg/[id] instead.
				uploadedAt: attachment.uploadedAt
			})
			.from(attachment)
			.where(and(eq(attachment.bankTransactionId, transactionId), eq(attachment.organizationId, orgId)))
			.orderBy(desc(attachment.uploadedAt));
	}
);

export const upload_attachment = command(
	v.object({
		transactionId: v.pipe(v.string(), v.minLength(1)),
		fileName: v.pipe(v.string(), v.minLength(1)),
		mimeType: v.picklist(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
		content: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ transactionId, fileName, mimeType, content }) => {
		const orgId = requireOrgId();
		const [tx] = await db
			.select({ id: bankTransaction.id })
			.from(bankTransaction)
			.where(and(eq(bankTransaction.id, transactionId), eq(bankTransaction.organizationId, orgId)))
			.limit(1);
		if (!tx) error(404, 'Transaksjon ikke funnet');
		await db.insert(attachment).values({
			id: generateId(),
			bankTransactionId: transactionId,
			organizationId: orgId,
			fileName,
			mimeType,
			content,
			uploadedAt: new Date()
		});
	}
);

export const delete_attachment = command(
	v.object({ attachmentId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ attachmentId }) => {
		const orgId = requireOrgId();
		await db
			.delete(attachment)
			.where(and(eq(attachment.id, attachmentId), eq(attachment.organizationId, orgId)));
	}
);

export const set_receipt_not_required = command(
	v.object({ transactionId: v.pipe(v.string(), v.minLength(1)), value: v.boolean() }),
	async ({ transactionId, value }) => {
		const orgId = requireAdmin();
		await db
			.update(bankTransaction)
			.set({ receiptNotRequired: value })
			.where(and(eq(bankTransaction.id, transactionId), eq(bankTransaction.organizationId, orgId)));
	}
);
