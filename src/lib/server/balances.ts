import { and, eq, isNotNull, sql, sum } from 'drizzle-orm';
import { db } from './db';
import { expectedRentByOwner } from './rent';
import { inYear } from './period';
import { bankTransaction, ledgerAccount, voucher, voucherLine } from '$lib/schema';

const ore = (value: string | null | undefined) => parseInt(value ?? '0');

/**
 * Balances at the end of a fiscal year: what the balance report shows, and where the next
 * year's OPENING voucher starts.
 *
 * - Bank follows the physical money: the opening balance plus every bank transaction in the
 *   year, categorised or not.
 * - Loan (2400) and owner balances come from voucher lines, including the OPENING voucher.
 * - Owner balance = what the owner has paid (credit minus debit on lines carrying their id)
 *   minus expected felleskostnader. Positive means prepaid (2770), negative means owed (1500).
 */
export async function closingBalances(organizationId: string, year: number) {
	const fiscalYear = and(eq(voucher.organizationId, organizationId), eq(voucher.fiscalYear, year));
	const netDebit = sql<string>`COALESCE(SUM(${voucherLine.debitOre}) - SUM(${voucherLine.creditOre}), 0)`;
	const netOnAccount = (code: string, openingOnly: boolean) =>
		db
			.select({ net: netDebit })
			.from(voucherLine)
			.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
			.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
			.where(and(fiscalYear, eq(ledgerAccount.code, code), openingOnly ? eq(voucher.source, 'OPENING') : undefined));

	const [[openingBank], [bankMovements], [loan], { expected }] = await Promise.all([
		netOnAccount('1920', true),
		db
			.select({ total: sum(bankTransaction.amountOre) })
			.from(bankTransaction)
			.where(and(eq(bankTransaction.organizationId, organizationId), inYear(bankTransaction.date, year))),
		netOnAccount('2400', false),
		expectedRentByOwner(organizationId, year)
	]);

	// Every owner with lines in the year, not only those owing rent in it: a seller who left with
	// arrears has an opening 1500 line but no ownership this year, and must not drop out.
	const paidRows = await db
		.select({ ownerId: voucherLine.ownerId, net: netDebit })
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.where(and(fiscalYear, isNotNull(voucherLine.ownerId)))
		.groupBy(voucherLine.ownerId);
	const paid = new Map(paidRows.map((r) => [r.ownerId!, -ore(r.net)]));
	const ownerIds = [...new Set([...expected.keys(), ...paid.keys()])];

	return {
		bankOre: ore(openingBank?.net) + ore(bankMovements?.total),
		loanOre: -ore(loan?.net),
		ownerBalances: ownerIds.map((ownerId) => ({
			ownerId,
			balanceOre: (paid.get(ownerId) ?? 0) - (expected.get(ownerId) ?? 0)
		}))
	};
}
