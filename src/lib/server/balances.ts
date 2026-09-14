import { and, asc, eq, inArray, isNotNull, sql, sum } from 'drizzle-orm';
import { db } from './db';
import { expectedRentByOwner } from './rent';
import { inYear } from './period';
import { createOpeningVoucher } from './voucher';
import { accountingPeriod, bankTransaction, ledgerAccount, voucher, voucherLine } from '$lib/schema';

const ore = (value: string | null | undefined) => parseInt(value ?? '0');

/**
 * Felleskostnader per owner for a fiscal year, all in øre and positive in the owner's favour:
 * - openingOre: balance carried in on the OPENING voucher (2770 prepaid, 1500 owed)
 * - paidOre: every other voucher line carrying the owner (payments, minus refunds)
 * - expectedOre: felleskostnader for the months due so far
 * - balanceOre = opening + paid - expected; negative means the owner owes
 *
 * Covers every owner who owes rent in the year or has lines in it, so a seller who left with
 * arrears doesn't drop out. The dashboard and the balance report both read from here.
 */
export async function ownerLedger(organizationId: string, year: number, today = new Date()) {
	const inFavour = sql`${voucherLine.creditOre} - ${voucherLine.debitOre}`;
	const [{ ownerships, expected }, rows] = await Promise.all([
		expectedRentByOwner(organizationId, year, today),
		db
			.select({
				ownerId: voucherLine.ownerId,
				opening: sql<string>`COALESCE(SUM(CASE WHEN ${voucher.source} = 'OPENING' THEN ${inFavour} ELSE 0 END), 0)`,
				paid: sql<string>`COALESCE(SUM(CASE WHEN ${voucher.source} <> 'OPENING' THEN ${inFavour} ELSE 0 END), 0)`
			})
			.from(voucherLine)
			.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
			.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year), isNotNull(voucherLine.ownerId)))
			.groupBy(voucherLine.ownerId)
	]);

	const lines = new Map(rows.map((r) => [r.ownerId!, { openingOre: ore(r.opening), paidOre: ore(r.paid) }]));
	const ownerIds = [...new Set([...expected.keys(), ...lines.keys()])];
	return {
		ownerships,
		owners: ownerIds.map((ownerId) => {
			const { openingOre, paidOre } = lines.get(ownerId) ?? { openingOre: 0, paidOre: 0 };
			const expectedOre = expected.get(ownerId) ?? 0;
			return { ownerId, openingOre, paidOre, expectedOre, balanceOre: openingOre + paidOre - expectedOre };
		})
	};
}

/**
 * Balances at the end of a fiscal year: what the balance report shows, and where the next
 * year's OPENING voucher starts.
 *
 * - Bank follows the physical money: the opening balance plus every bank transaction in the
 *   year, categorised or not.
 * - Loan (2400) comes from voucher lines, including the OPENING voucher.
 * - Owner balances come from ownerLedger: positive means prepaid (2770), negative means owed (1500).
 */
export async function closingBalances(organizationId: string, year: number) {
	const netOnAccount = (code: string, openingOnly: boolean) =>
		db
			.select({ net: sql<string>`COALESCE(SUM(${voucherLine.debitOre}) - SUM(${voucherLine.creditOre}), 0)` })
			.from(voucherLine)
			.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
			.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
			.where(
				and(
					eq(voucher.organizationId, organizationId),
					eq(voucher.fiscalYear, year),
					eq(ledgerAccount.code, code),
					openingOnly ? eq(voucher.source, 'OPENING') : undefined
				)
			);

	const [[openingBank], [bankMovements], [loan], { owners }] = await Promise.all([
		netOnAccount('1920', true),
		db
			.select({ total: sum(bankTransaction.amountOre) })
			.from(bankTransaction)
			.where(and(eq(bankTransaction.organizationId, organizationId), inYear(bankTransaction.date, year))),
		netOnAccount('2400', false),
		ownerLedger(organizationId, year)
	]);

	return {
		bankOre: ore(openingBank?.net) + ore(bankMovements?.total),
		loanOre: -ore(loan?.net),
		ownerBalances: owners.map(({ ownerId, balanceOre }) => ({ ownerId, balanceOre }))
	};
}

/**
 * Keeps every OPEN year's opening balances equal to the previous year's closing balances, oldest year
 * first so each year starts from an up-to-date predecessor. A sameie's first year has no predecessor
 * and keeps the balances entered at onboarding. createOpeningVoucher posts a correction only when
 * something changed, so this is cheap enough to call before showing opening-derived figures.
 */
export async function syncOpeningBalances(organizationId: string) {
	const periods = await db
		.select({ year: accountingPeriod.year, status: accountingPeriod.status })
		.from(accountingPeriod)
		.where(eq(accountingPeriod.organizationId, organizationId))
		.orderBy(asc(accountingPeriod.year));
	for (const { year, status } of periods) {
		if (status !== 'OPEN' || !periods.some((p) => p.year === year - 1)) continue;
		const closing = await closingBalances(organizationId, year - 1);
		await db.transaction((tx) => createOpeningVoucher(tx, { organizationId, year, ...closing }));
	}
}

type ReportLine = { code: string; name: string; amountOre: number };
const total = (lines: ReportLine[]) => lines.reduce((s, l) => s + l.amountOre, 0);

/** Net amount per ledger account of the given types for a fiscal year, as debit minus credit. */
function netPerAccount(organizationId: string, year: number, types: string[]) {
	return db
		.select({
			code: ledgerAccount.code,
			name: ledgerAccount.name,
			type: ledgerAccount.type,
			net: sql<string>`COALESCE(SUM(${voucherLine.debitOre}) - SUM(${voucherLine.creditOre}), 0)`
		})
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
		.where(and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year), inArray(ledgerAccount.type, types)))
		.groupBy(ledgerAccount.code, ledgerAccount.name, ledgerAccount.type)
		.orderBy(ledgerAccount.code);
}

/**
 * Resultatregnskap, amounts positive. Felleskostnader (3600) is what owners owe for the months due
 * (accrual basis), not what they happened to pay; other income and all expense accounts are the
 * year's postings.
 */
export async function incomeStatement(organizationId: string, year: number) {
	const [{ expected }, rows] = await Promise.all([
		expectedRentByOwner(organizationId, year),
		netPerAccount(organizationId, year, ['INCOME', 'EXPENSE'])
	]);
	const felleskostnader = [...expected.values()].reduce((s, v) => s + v, 0);
	const income: ReportLine[] = [
		...(felleskostnader > 0 ? [{ code: '3600', name: 'Felleskostnader', amountOre: felleskostnader }] : []),
		...rows.filter((r) => r.type === 'INCOME' && r.code !== '3600').map((r) => ({ code: r.code, name: r.name, amountOre: -ore(r.net) }))
	];
	const expenses: ReportLine[] = rows
		.filter((r) => r.type === 'EXPENSE')
		.map((r) => ({ code: r.code, name: r.name, amountOre: ore(r.net) }));
	return { income, expenses, incomeOre: total(income), expensesOre: total(expenses), resultOre: total(income) - total(expenses) };
}

/**
 * Balanserapport at the end of a fiscal year, amounts positive on their natural side.
 *
 * Bank, receivables from owners (1500) and prepaid felleskostnader (2770) come from
 * closingBalances; every other asset, liability and equity account from its voucher lines.
 * Equity is the booked equity accounts (opening equity on 2050) plus the year's result.
 * differenceOre is assets minus liabilities and equity. Every categorised bank transaction is
 * posted on both sides, so it equals the year's uncategorised bank transactions; anything else
 * means the books are inconsistent. It is reported, never folded into equity.
 */
export async function balanceSheet(organizationId: string, year: number) {
	const [closing, statement, rows, names] = await Promise.all([
		closingBalances(organizationId, year),
		incomeStatement(organizationId, year),
		netPerAccount(organizationId, year, ['ASSET', 'LIABILITY', 'EQUITY']),
		db
			.select({ code: ledgerAccount.code, name: ledgerAccount.name })
			.from(ledgerAccount)
			.where(and(eq(ledgerAccount.organizationId, organizationId), inArray(ledgerAccount.code, ['1920', '1500', '2770'])))
	]);
	const nameOf = (code: string, fallback: string) => names.find((n) => n.code === code)?.name ?? fallback;
	const nonZero = (l: ReportLine) => l.amountOre !== 0;
	const booked = (type: string, sign: 1 | -1) =>
		rows
			.filter((r) => r.type === type && !['1920', '1500', '2770'].includes(r.code))
			.map((r) => ({ code: r.code, name: r.name, amountOre: sign * ore(r.net) }))
			.filter(nonZero);

	const receivableOre = closing.ownerBalances.reduce((s, o) => s + Math.max(0, -o.balanceOre), 0);
	const prepaidOre = closing.ownerBalances.reduce((s, o) => s + Math.max(0, o.balanceOre), 0);

	const assets: ReportLine[] = [
		{ code: '1920', name: nameOf('1920', 'Bankinnskudd'), amountOre: closing.bankOre },
		...[{ code: '1500', name: nameOf('1500', 'Fordring på eiere'), amountOre: receivableOre }].filter(nonZero),
		...booked('ASSET', 1)
	];
	const liabilities: ReportLine[] = [
		...[{ code: '2770', name: nameOf('2770', 'Forhåndsbetalt fellesutgifter'), amountOre: prepaidOre }].filter(nonZero),
		...booked('LIABILITY', -1)
	];
	const equity: ReportLine[] = [...booked('EQUITY', -1), { code: '', name: 'Årets resultat', amountOre: statement.resultOre }];

	const assetsOre = total(assets);
	const liabilitiesOre = total(liabilities);
	const equityOre = total(equity);
	return { assets, liabilities, equity, assetsOre, liabilitiesOre, equityOre, differenceOre: assetsOre - liabilitiesOre - equityOre };
}
