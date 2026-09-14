import { error } from '@sveltejs/kit';
import { db } from './db';
import { voucher, voucherLine, ledgerAccount, bankTransaction } from '$lib/schema';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { generateId } from 'better-auth';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

async function getAccountIdByCode(tx: DbOrTx, organizationId: string, code: string): Promise<string> {
	const [row] = await tx
		.select({ id: ledgerAccount.id })
		.from(ledgerAccount)
		.where(and(eq(ledgerAccount.organizationId, organizationId), eq(ledgerAccount.code, code)))
		.limit(1);
	if (!row) error(409, `Mangler konto ${code} i kontoplanen`);
	return row.id;
}

async function getBankAccountId(tx: DbOrTx, organizationId: string): Promise<string> {
	return getAccountIdByCode(tx, organizationId, '1920');
}

/**
 * First free voucher number in a fiscal year. The advisory lock serialises numbering per (org, year)
 * until the transaction ends; without it two concurrent imports read the same MAX and one of them
 * fails on voucher_org_year_number_idx. The caller may use consecutive numbers from the result.
 */
async function reserveVoucherNumbers(tx: Tx, organizationId: string, fiscalYear: number): Promise<number> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}::text), ${fiscalYear}::int)`);
	const [row] = await tx
		.select({ max: sql<number | null>`MAX(${voucher.voucherNumber})` })
		.from(voucher)
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, fiscalYear)));
	return (row?.max ?? 0) + 1;
}

function* chunks<T>(rows: T[], size = 1000): Generator<T[]> {
	for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

type BankVoucher = {
	bankTransactionId: string;
	date: string;
	amountOre: number;
	counterAccountId: string;
	ownerId?: string | null;
	description: string;
};

/**
 * Genererer auto-bilag for bank-transaksjoner (1:1, to linjer hver) og setter bankTransaction.voucherId.
 * Innbetaling (amountOre > 0): debet bank, kredit motkonto.
 * Utbetaling (amountOre < 0): debet motkonto, kredit bank.
 * Batched: a few statements whatever the number of rows, so a year's statement imports in one go.
 */
export async function createBankAutoVouchers(tx: Tx, organizationId: string, items: BankVoucher[]): Promise<void> {
	if (items.length === 0) return;
	if (items.some((i) => i.amountOre === 0)) error(400, 'Kan ikke generere bilag for transaksjon med beløp 0');

	const bankAccountId = await getBankAccountId(tx, organizationId);
	const fiscalYearOf = (date: string) => parseInt(date.substring(0, 4));
	const vouchers: (typeof voucher.$inferInsert)[] = [];
	const lines: (typeof voucherLine.$inferInsert)[] = [];
	const links: { bankTransactionId: string; voucherId: string }[] = [];
	const createdAt = new Date();

	// Ascending year order, so concurrent callers take the advisory locks in the same order
	const years = [...new Set(items.map((i) => fiscalYearOf(i.date)))].sort((a, b) => a - b);
	for (const fiscalYear of years) {
		let voucherNumber = await reserveVoucherNumbers(tx, organizationId, fiscalYear);
		for (const item of items) {
			if (fiscalYearOf(item.date) !== fiscalYear) continue;
			const voucherId = generateId();
			const abs = Math.abs(item.amountOre);
			const isIncoming = item.amountOre > 0;
			vouchers.push({
				id: voucherId,
				organizationId,
				voucherNumber: voucherNumber++,
				fiscalYear,
				date: item.date,
				description: item.description,
				source: 'BANK_AUTO',
				createdAt
			});
			lines.push(
				{
					id: generateId(),
					voucherId,
					lineNumber: 1,
					ledgerAccountId: isIncoming ? bankAccountId : item.counterAccountId,
					debitOre: abs,
					creditOre: 0,
					ownerId: isIncoming ? null : (item.ownerId ?? null)
				},
				{
					id: generateId(),
					voucherId,
					lineNumber: 2,
					ledgerAccountId: isIncoming ? item.counterAccountId : bankAccountId,
					debitOre: 0,
					creditOre: abs,
					ownerId: isIncoming ? (item.ownerId ?? null) : null
				}
			);
			links.push({ bankTransactionId: item.bankTransactionId, voucherId });
		}
	}

	for (const chunk of chunks(vouchers)) await tx.insert(voucher).values(chunk);
	for (const chunk of chunks(lines)) await tx.insert(voucherLine).values(chunk);
	for (const chunk of chunks(links)) {
		const values = sql.join(chunk.map((l) => sql`(${l.bankTransactionId}, ${l.voucherId})`), sql`, `);
		await tx.execute(
			sql`update bank_transaction set voucher_id = v.voucher_id from (values ${values}) as v(id, voucher_id) where bank_transaction.id = v.id`
		);
	}
}

export async function createBankAutoVoucher(tx: Tx, opts: BankVoucher & { organizationId: string }): Promise<void> {
	await createBankAutoVouchers(tx, opts.organizationId, [opts]);
}

export async function readOpeningState(
	tx: DbOrTx,
	organizationId: string,
	year: number
): Promise<{ bankOre: number; loanOre: number; ownerBalances: Array<{ ownerId: string; balanceOre: number }> } | null> {
	const [v] = await tx
		.select({ id: voucher.id })
		.from(voucher)
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING')))
		.limit(1);
	if (!v) return null;

	const lines = await tx
		.select({ code: ledgerAccount.code, debitOre: voucherLine.debitOre, creditOre: voucherLine.creditOre, ownerId: voucherLine.ownerId })
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING')));

	// Net amounts per account, so negative balances (overdrawn bank, stored on the credit side) survive a round trip
	let bankOre = 0;
	let loanOre = 0;
	const owners = new Map<string, number>();

	for (const line of lines) {
		const debitMinusCredit = line.debitOre - line.creditOre;
		if (line.code === '1920') bankOre += debitMinusCredit;
		else if (line.code === '2400') loanOre -= debitMinusCredit;
		// Positive = owner has prepaid (2770), negative = owner owes (1500)
		else if ((line.code === '1500' || line.code === '2770') && line.ownerId) {
			owners.set(line.ownerId, (owners.get(line.ownerId) ?? 0) - debitMinusCredit);
		}
	}

	const ownerBalances = [...owners].filter(([, balanceOre]) => balanceOre !== 0).map(([ownerId, balanceOre]) => ({ ownerId, balanceOre }));
	return { bankOre, loanOre, ownerBalances };
}

type OpeningState = { bankOre: number; loanOre: number; ownerBalances: Array<{ ownerId: string; balanceOre: number }> };
type Posting = Pick<typeof voucherLine.$inferInsert, 'ledgerAccountId' | 'debitOre' | 'creditOre' | 'ownerId'>;
type OpeningAccounts = Record<'1920' | '2400' | '1500' | '2050' | '2770', string>;

/** Two lines per amount against equity (2050): bank on 1920, loan on 2400, an owner on 1500 (owes) or 2770 (prepaid). */
function openingPostings(acc: OpeningAccounts, state: OpeningState): Posting[] {
	const pair = (debitAccount: string, creditAccount: string, amount: number, ownerId: string | null = null, ownerOnDebit = false): Posting[] => [
		{ ledgerAccountId: debitAccount, debitOre: amount, creditOre: 0, ownerId: ownerOnDebit ? ownerId : null },
		{ ledgerAccountId: creditAccount, debitOre: 0, creditOre: amount, ownerId: ownerOnDebit ? null : ownerId }
	];
	const postings: Posting[] = [];
	if (state.bankOre > 0) postings.push(...pair(acc['1920'], acc['2050'], state.bankOre));
	if (state.bankOre < 0) postings.push(...pair(acc['2050'], acc['1920'], -state.bankOre));
	if (state.loanOre > 0) postings.push(...pair(acc['2050'], acc['2400'], state.loanOre));
	if (state.loanOre < 0) postings.push(...pair(acc['2400'], acc['2050'], -state.loanOre));
	for (const { ownerId, balanceOre } of state.ownerBalances) {
		if (balanceOre < 0) postings.push(...pair(acc['1500'], acc['2050'], -balanceOre, ownerId, true));
		if (balanceOre > 0) postings.push(...pair(acc['2050'], acc['2770'], balanceOre, ownerId));
	}
	return postings;
}

/**
 * Sets a year's opening balances to `opts`. The first call posts the OPENING voucher. Later calls never
 * delete it (bokføringsloven: posted vouchers stay traceable): they post an OPENING correction, linked
 * to the previous one, that reverses the old value of each part that changed (bank, loan, an owner)
 * and posts the new value, so every account ends up right. Nothing changed, nothing posted.
 */
export async function createOpeningVoucher(tx: Tx, opts: { organizationId: string; year: number } & OpeningState): Promise<void> {
	const { organizationId, year } = opts;
	const [previous] = await tx
		.select({ id: voucher.id })
		.from(voucher)
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING')))
		.orderBy(desc(voucher.voucherNumber))
		.limit(1);
	const current = (await readOpeningState(tx, organizationId, year)) ?? { bankOre: 0, loanOre: 0, ownerBalances: [] };

	const was = new Map(current.ownerBalances.map((o) => [o.ownerId, o.balanceOre]));
	const becomes = new Map(opts.ownerBalances.map((o) => [o.ownerId, o.balanceOre]));
	const changedOwners = [...new Set([...was.keys(), ...becomes.keys()])].filter((id) => (was.get(id) ?? 0) !== (becomes.get(id) ?? 0));
	const changedParts = (bankOre: number, loanOre: number, owners: Map<string, number>): OpeningState => ({
		bankOre: current.bankOre !== opts.bankOre ? bankOre : 0,
		loanOre: current.loanOre !== opts.loanOre ? loanOre : 0,
		ownerBalances: changedOwners.map((ownerId) => ({ ownerId, balanceOre: owners.get(ownerId) ?? 0 }))
	});

	const codes = ['1920', '2400', '1500', '2050', '2770'] as const;
	const ids = await Promise.all(codes.map((code) => getAccountIdByCode(tx, organizationId, code)));
	const acc = Object.fromEntries(codes.map((code, i) => [code, ids[i]])) as OpeningAccounts;
	const postings = [
		...openingPostings(acc, changedParts(current.bankOre, current.loanOre, was)).map((p) => ({ ...p, debitOre: p.creditOre, creditOre: p.debitOre })),
		...openingPostings(acc, changedParts(opts.bankOre, opts.loanOre, becomes))
	];
	// The first OPENING voucher is posted even without lines: the balance report requires one
	if (previous && postings.length === 0) return;

	const voucherId = generateId();
	await tx.insert(voucher).values({
		id: voucherId,
		organizationId,
		voucherNumber: await reserveVoucherNumbers(tx, organizationId, year),
		fiscalYear: year,
		date: `${year}-01-01`,
		description: previous ? `Korreksjon av inngående saldo ${year}` : `Inngående saldo ${year}`,
		source: 'OPENING',
		reversesVoucherId: previous?.id ?? null,
		createdAt: new Date()
	});
	if (postings.length > 0) {
		await tx.insert(voucherLine).values(postings.map((p, i) => ({ ...p, id: generateId(), voucherId, lineNumber: i + 1 })));
	}
}

/**
 * Reverses a bank transaction's voucher before it is re-categorised or unmatched: posts a CORRECTION
 * voucher with the lines swapped, linked to the original and on its date (so the same fiscal year),
 * and clears bankTransaction.voucherId. The original is kept, so history and numbering stay intact.
 * Safe to call when the transaction has no voucher.
 */
export async function reverseBankAutoVoucher(tx: Tx, bankTransactionId: string): Promise<void> {
	const [original] = await tx
		.select({
			id: voucher.id,
			organizationId: voucher.organizationId,
			fiscalYear: voucher.fiscalYear,
			voucherNumber: voucher.voucherNumber,
			date: voucher.date,
			description: voucher.description
		})
		.from(bankTransaction)
		.innerJoin(voucher, eq(voucher.id, bankTransaction.voucherId))
		.where(eq(bankTransaction.id, bankTransactionId))
		.limit(1);
	if (!original) return;

	const lines = await tx
		.select({ ledgerAccountId: voucherLine.ledgerAccountId, debitOre: voucherLine.debitOre, creditOre: voucherLine.creditOre, ownerId: voucherLine.ownerId })
		.from(voucherLine)
		.where(eq(voucherLine.voucherId, original.id))
		.orderBy(asc(voucherLine.lineNumber));

	const voucherId = generateId();
	await tx.insert(voucher).values({
		id: voucherId,
		organizationId: original.organizationId,
		voucherNumber: await reserveVoucherNumbers(tx, original.organizationId, original.fiscalYear),
		fiscalYear: original.fiscalYear,
		date: original.date,
		description: `Korreksjon av bilag ${original.voucherNumber}: ${original.description}`,
		source: 'CORRECTION',
		reversesVoucherId: original.id,
		createdAt: new Date()
	});
	await tx.insert(voucherLine).values(
		lines.map((l, i) => ({ ...l, id: generateId(), voucherId, lineNumber: i + 1, debitOre: l.creditOre, creditOre: l.debitOre }))
	);
	await tx.update(bankTransaction).set({ voucherId: null }).where(eq(bankTransaction.id, bankTransactionId));
}
