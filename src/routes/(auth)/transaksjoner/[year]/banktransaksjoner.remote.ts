import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireOrgId } from '$lib/server/tenant';
import {
	bankTransaction,
	bankStatement,
	matchingRule,
	owner,
	ledgerAccount,
	accountingPeriod,
	attachment
} from '$lib/schema';
import { eq, and, sql, inArray, ilike, gt, lt, asc, desc } from 'drizzle-orm';
import { generateId } from 'better-auth';
import { createBankAutoVoucher, deleteBankAutoVoucher } from '$lib/server/voucher';

type ParsedRow = { date: string; description: string; amountOre: number };

function decodeBuffer(buf: Buffer): string {
	const utf8 = buf.toString('utf-8');
	if (!utf8.includes('\uFFFD')) return utf8;
	// Only use latin1 if it actually produces valid Norwegian characters (real Windows-1252 file)
	const latin1 = buf.toString('latin1');
	return /[æøåÆØÅ]/.test(latin1) ? latin1 : utf8;
}

function splitLine(line: string, sep: string): string[] {
	if (!line.includes('"')) return line.split(sep).map((s) => s.trim());
	const result: string[] = [];
	let inQuote = false;
	let current = '';
	for (const c of line) {
		if (c === '"') {
			inQuote = !inQuote;
		} else if (c === sep && !inQuote) {
			result.push(current.trim());
			current = '';
		} else {
			current += c;
		}
	}
	result.push(current.trim());
	return result;
}

function parseAmount(s: string): number | null {
	const cleaned = s.trim().replace(/\s/g, '');
	if (!cleaned) return null;
	// Norwegian format (8.758,00): remove dot thousands sep, replace comma decimal
	// US/plain format (41002.32): parse as-is
	const normalized = cleaned.includes(',')
		? cleaned.replace(/\./g, '').replace(',', '.')
		: cleaned;
	const val = parseFloat(normalized);
	return isNaN(val) ? null : val;
}

function fromDDMMYYYY(s: string): string {
	const [d, m, y] = s.trim().split('.');
	return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function fromMMDDYYYY(s: string): string {
	const [m, d, y] = s.trim().split('/');
	return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const DATE_DDMMYYYY = /^\d{2}\.\d{2}\.\d{4}/;
const DATE_MMDDYYYY = /^\d{1,2}\/\d{1,2}\/\d{4}/;

function parseBNBank(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const inn = parseAmount(cols[10]);
			const ut = parseAmount(cols[11]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[3], amountOre: Math.round(amount * 100) }];
		});
}

function parseDNB(lines: string[]): ParsedRow[] {
	// 4 metadata lines, header on line 4, data from line 5
	return lines
		.slice(5)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const ut = parseAmount(cols[5]);
			const inn = parseAmount(cols[6]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[1], amountOre: Math.round(amount * 100) }];
		});
}

function parseSparebank1(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ',');
			if (!DATE_MMDDYYYY.test(cols[0])) return [];
			const inn = parseAmount(cols[3]);
			const ut = parseAmount(cols[4]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromMMDDYYYY(cols[0]), description: cols[1], amountOre: Math.round(amount * 100) }];
		});
}

function parseSparebankenVest(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const amount = parseAmount(cols[6]);
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[4], amountOre: Math.round(amount * 100) }];
		});
}

function detectAndParse(buf: Buffer): ParsedRow[] {
	const text = decodeBuffer(buf).replace(/^\uFEFF/, ''); // strip BOM
	const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const first = lines[0] ?? '';
	// Split on first separator to get the first field (ASCII-stable even when ø/æ/å is garbled)
	const firstField = first.split(first.includes(',') ? ',' : ';')[0].trim();

	if (first.startsWith('Dato,')) return parseSparebank1(lines);
	if (first.includes('"Konto"')) return parseDNB(lines);
	// SPV: Bokfø rt ... (first field starts with "Bokf")
	if (firstField.startsWith('Bokf') || first.includes('Beløp (NOK)')) return parseSparebankenVest(lines);
	// BN Bank: Utfø rt dato ... (first field starts with "Utf")
	if (firstField.startsWith('Utf')) return parseBNBank(lines);

	error(400, 'Ukjent bankformat');
}

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
					year ? sql`EXTRACT(YEAR FROM ${bankTransaction.date}::date) = ${year}` : undefined,
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

export const get_open_periods = query(async () => {
	const orgId = requireOrgId();
	return db
		.select()
		.from(accountingPeriod)
		.where(and(eq(accountingPeriod.organizationId, orgId), eq(accountingPeriod.status, 'OPEN')))
		.orderBy(accountingPeriod.year);
});

export const import_csv = command(
	v.object({
		csvBase64: v.pipe(v.string(), v.minLength(1)),
		fileName: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ csvBase64, fileName }) => {
		const orgId = requireOrgId();

		const buf = Buffer.from(csvBase64, 'base64');
		const csvText = decodeBuffer(buf);
		const parsed = detectAndParse(buf);

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

		// Fetch existing transactions to detect duplicates
		const existing = await db
			.select({
				date: bankTransaction.date,
				description: bankTransaction.description,
				amountOre: bankTransaction.amountOre
			})
			.from(bankTransaction)
			.where(eq(bankTransaction.organizationId, orgId));

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

			const match = rules.find((r) =>
				row.description.toLowerCase().includes(r.pattern.toLowerCase())
			);

			if (match) {
				if (match.ownerId) {
					// Owner rules match both income (innbetaling) and refunds (tilbakebetaling)
					matchedOwnerId = match.ownerId;
					ledgerAccountId = account3600Id;
					status = 'MATCHED';
				} else if (row.amountOre < 0 && match.ledgerAccountId) {
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
				for (const r of toInsert) {
					if (r.status === 'UNMATCHED' || !r.ledgerAccountId) continue;
					await createBankAutoVoucher(tx, {
						organizationId: orgId,
						bankTransactionId: r.id,
						date: r.date,
						amountOre: r.amountOre,
						counterAccountId: r.ledgerAccountId,
						ownerId: r.matchedOwnerId,
						description: r.userDescription ?? r.description
					});
				}
			}
		});

		await get_statements().refresh();

		return { imported: toInsert.length, skipped: skippedCount };
	}
);

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
		const orgId = requireOrgId();
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
		const orgId = requireOrgId();
		await assertInOrg(owner, [ownerId], orgId);
		const ledgerAccountId = await get3600AccountId(orgId);
		if (!ledgerAccountId) error(409, 'Mangler konto 3600 i kontoplanen');
		const matched = await db.transaction(async (tx) => {
			await tx
				.insert(matchingRule)
				.values({ id: generateId(), organizationId: orgId, pattern, ownerId, receiptNotRequired, userDescription });
			const updated = await tx
				.update(bankTransaction)
				.set({
					matchedOwnerId: ownerId,
					ledgerAccountId,
					status: 'MATCHED',
					...(receiptNotRequired ? { receiptNotRequired: true } : {}),
					...(userDescription ? { userDescription } : {})
				})
				.where(
					and(
						eq(bankTransaction.organizationId, orgId),
						eq(bankTransaction.status, 'UNMATCHED'),
						sql`${bankTransaction.amountOre} > 0`,
						ilike(bankTransaction.description, `%${pattern}%`)
					)
				)
				.returning({
					id: bankTransaction.id,
					date: bankTransaction.date,
					amountOre: bankTransaction.amountOre,
					description: bankTransaction.description,
					userDescription: bankTransaction.userDescription
				});
			for (const row of updated) {
				await createBankAutoVoucher(tx, {
					organizationId: orgId,
					bankTransactionId: row.id,
					date: row.date,
					amountOre: row.amountOre,
					counterAccountId: ledgerAccountId,
					ownerId,
					description: row.userDescription ?? row.description
				});
			}
			return updated.length;
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
		const orgId = requireOrgId();
		await assertInOrg(ledgerAccount, [ledgerAccountId], orgId);
		const categorized = await db.transaction(async (tx) => {
			await tx
				.insert(matchingRule)
				.values({ id: generateId(), organizationId: orgId, pattern, ledgerAccountId, receiptNotRequired, userDescription });
			const updated = await tx
				.update(bankTransaction)
				.set({
					ledgerAccountId,
					status: 'CATEGORIZED',
					...(receiptNotRequired ? { receiptNotRequired: true } : {}),
					...(userDescription ? { userDescription } : {})
				})
				.where(
					and(
						eq(bankTransaction.organizationId, orgId),
						eq(bankTransaction.status, 'UNMATCHED'),
						sql`${bankTransaction.amountOre} < 0`,
						ilike(bankTransaction.description, `%${pattern}%`)
					)
				)
				.returning({
					id: bankTransaction.id,
					date: bankTransaction.date,
					amountOre: bankTransaction.amountOre,
					description: bankTransaction.description,
					userDescription: bankTransaction.userDescription
				});
			for (const row of updated) {
				await createBankAutoVoucher(tx, {
					organizationId: orgId,
					bankTransactionId: row.id,
					date: row.date,
					amountOre: row.amountOre,
					counterAccountId: ledgerAccountId,
					description: row.userDescription ?? row.description
				});
			}
			return updated.length;
		});
		return { categorized };
	}
);

export const unmatch_transaction = command(
	v.object({ transactionId: v.string() }),
	async ({ transactionId }) => {
		const orgId = requireOrgId();
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
		const orgId = requireOrgId();
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
		const orgId = requireOrgId();
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
		const orgId = requireOrgId();
		await db
			.update(bankTransaction)
			.set({ receiptNotRequired: value })
			.where(and(eq(bankTransaction.id, transactionId), eq(bankTransaction.organizationId, orgId)));
	}
);
