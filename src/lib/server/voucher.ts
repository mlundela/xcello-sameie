import { error } from '@sveltejs/kit';
import { db } from './db';
import { voucher, voucherLine, ledgerAccount, bankTransaction } from '$lib/schema';
import { eq, and, sql } from 'drizzle-orm';
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

export async function createOpeningVoucher(
	tx: Tx,
	opts: {
		organizationId: string;
		year: number;
		bankOre: number;
		loanOre: number;
		ownerBalances: Array<{ ownerId: string; balanceOre: number }>;
	}
): Promise<string> {
	await tx.delete(voucher).where(
		and(eq(voucher.organizationId, opts.organizationId), eq(voucher.fiscalYear, opts.year), eq(voucher.source, 'OPENING'))
	);

	const [acc1920, acc2400, acc1500, acc2050, acc2770] = await Promise.all([
		getAccountIdByCode(tx, opts.organizationId, '1920'),
		getAccountIdByCode(tx, opts.organizationId, '2400'),
		getAccountIdByCode(tx, opts.organizationId, '1500'),
		getAccountIdByCode(tx, opts.organizationId, '2050'),
		getAccountIdByCode(tx, opts.organizationId, '2770')
	]);

	const voucherNumber = await reserveVoucherNumbers(tx, opts.organizationId, opts.year);
	const voucherId = generateId();

	await tx.insert(voucher).values({
		id: voucherId,
		organizationId: opts.organizationId,
		voucherNumber,
		fiscalYear: opts.year,
		date: `${opts.year}-01-01`,
		description: `Inngående saldo ${opts.year}`,
		source: 'OPENING',
		createdAt: new Date()
	});

	const lines: (typeof voucherLine.$inferInsert)[] = [];
	let n = 1;

	if (opts.bankOre !== 0) {
		const abs = Math.abs(opts.bankOre);
		const [debitAcc, creditAcc] = opts.bankOre > 0 ? [acc1920, acc2050] : [acc2050, acc1920];
		lines.push(
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: debitAcc, debitOre: abs, creditOre: 0, ownerId: null },
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: creditAcc, debitOre: 0, creditOre: abs, ownerId: null }
		);
	}

	if (opts.loanOre !== 0) {
		const abs = Math.abs(opts.loanOre);
		const [debitAcc, creditAcc] = opts.loanOre > 0 ? [acc2050, acc2400] : [acc2400, acc2050];
		lines.push(
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: debitAcc, debitOre: abs, creditOre: 0, ownerId: null },
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: creditAcc, debitOre: 0, creditOre: abs, ownerId: null }
		);
	}

	for (const { ownerId, balanceOre } of opts.ownerBalances) {
		if (balanceOre === 0) continue;
		const abs = Math.abs(balanceOre);
		if (balanceOre < 0) {
			lines.push(
				{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc1500, debitOre: abs, creditOre: 0, ownerId },
				{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc2050, debitOre: 0, creditOre: abs, ownerId: null }
			);
		} else {
			lines.push(
				{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc2050, debitOre: abs, creditOre: 0, ownerId: null },
				{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc2770, debitOre: 0, creditOre: abs, ownerId }
			);
		}
	}

	if (lines.length > 0) await tx.insert(voucherLine).values(lines);

	return voucherId;
}

/**
 * Sletter bilaget koblet til en bank-transaksjon (cascade fjerner linjene).
 * Trygt å kalle selv om transaksjonen ikke har et bilag.
 */
export async function deleteBankAutoVoucher(
	tx: DbOrTx,
	bankTransactionId: string
): Promise<void> {
	const [row] = await tx
		.select({ voucherId: bankTransaction.voucherId })
		.from(bankTransaction)
		.where(eq(bankTransaction.id, bankTransactionId))
		.limit(1);
	if (!row?.voucherId) return;

	await tx
		.update(bankTransaction)
		.set({ voucherId: null })
		.where(eq(bankTransaction.id, bankTransactionId));
	await tx.delete(voucher).where(eq(voucher.id, row.voucherId));
}
