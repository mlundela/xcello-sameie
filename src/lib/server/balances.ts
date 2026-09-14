import { and, eq, isNotNull, sql, sum } from 'drizzle-orm';
import { db } from './db';
import { expectedRentByOwner } from './rent';
import { inYear } from './period';
import { bankTransaction, ledgerAccount, voucher, voucherLine } from '$lib/schema';

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
