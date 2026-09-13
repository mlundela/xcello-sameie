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
	if (!row) throw new Error(`Mangler konto ${code} i kontoplanen`);
	return row.id;
}

async function getBankAccountId(tx: DbOrTx, organizationId: string): Promise<string> {
	return getAccountIdByCode(tx, organizationId, '1920');
}

async function nextVoucherNumber(
	tx: DbOrTx,
	organizationId: string,
	fiscalYear: number
): Promise<number> {
	const [row] = await tx
		.select({ max: sql<number | null>`MAX(${voucher.voucherNumber})` })
		.from(voucher)
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, fiscalYear)));
	return (row?.max ?? 0) + 1;
}

/**
 * Genererer et auto-bilag for en bank-transaksjon (1:1, to linjer).
 * Innbetaling (amountOre > 0): debet bank, kredit motkonto.
 * Utbetaling (amountOre < 0): debet motkonto, kredit bank.
 * Setter også bankTransaction.voucherId.
 */
export async function createBankAutoVoucher(
	tx: DbOrTx,
	opts: {
		organizationId: string;
		bankTransactionId: string;
		date: string;
		amountOre: number;
		counterAccountId: string;
		ownerId?: string | null;
		description: string;
	}
): Promise<string> {
	if (opts.amountOre === 0) throw new Error('Kan ikke generere bilag for transaksjon med beløp 0');

	const bankAccountId = await getBankAccountId(tx, opts.organizationId);
	const fiscalYear = parseInt(opts.date.substring(0, 4));
	const voucherNumber = await nextVoucherNumber(tx, opts.organizationId, fiscalYear);
	const voucherId = generateId();
	const abs = Math.abs(opts.amountOre);
	const isIncoming = opts.amountOre > 0;

	await tx.insert(voucher).values({
		id: voucherId,
		organizationId: opts.organizationId,
		voucherNumber,
		fiscalYear,
		date: opts.date,
		description: opts.description,
		source: 'BANK_AUTO',
		createdAt: new Date()
	});

	await tx.insert(voucherLine).values([
		{
			id: generateId(),
			voucherId,
			lineNumber: 1,
			ledgerAccountId: isIncoming ? bankAccountId : opts.counterAccountId,
			debitOre: abs,
			creditOre: 0,
			ownerId: !isIncoming ? opts.ownerId ?? null : null
		},
		{
			id: generateId(),
			voucherId,
			lineNumber: 2,
			ledgerAccountId: isIncoming ? opts.counterAccountId : bankAccountId,
			debitOre: 0,
			creditOre: abs,
			ownerId: isIncoming ? opts.ownerId ?? null : null
		}
	]);

	await tx
		.update(bankTransaction)
		.set({ voucherId })
		.where(eq(bankTransaction.id, opts.bankTransactionId));

	return voucherId;
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

	let bankOre = 0;
	let loanOre = 0;
	const ownerBalances: Array<{ ownerId: string; balanceOre: number }> = [];

	for (const line of lines) {
		if (line.code === '1920' && line.debitOre > 0) bankOre = line.debitOre;
		else if (line.code === '2400' && line.creditOre > 0) loanOre = line.creditOre;
		else if (line.code === '1500' && line.debitOre > 0 && line.ownerId) {
			ownerBalances.push({ ownerId: line.ownerId, balanceOre: -line.debitOre });
		} else if (line.code === '2770' && line.creditOre > 0 && line.ownerId) {
			ownerBalances.push({ ownerId: line.ownerId, balanceOre: line.creditOre });
		}
	}

	return { bankOre, loanOre, ownerBalances };
}

export async function createOpeningVoucher(
	tx: DbOrTx,
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

	const voucherNumber = await nextVoucherNumber(tx, opts.organizationId, opts.year);
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
		lines.push(
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc2050, debitOre: abs, creditOre: 0, ownerId: null },
			{ id: generateId(), voucherId, lineNumber: n++, ledgerAccountId: acc2400, debitOre: 0, creditOre: abs, ownerId: null }
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
