// Accounting logic against Postgres (DATABASE_URL). Migrations run first; every test creates its
// own throwaway sameie, and all of them are deleted at the end (organization deletes cascade).
import '$lib/server/migrate';
import { afterAll, describe, expect, test } from 'bun:test';
import { generateId } from 'better-auth';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as s from '$lib/schema';
import { DEFAULT_ACCOUNTS } from '$lib/server/default-accounts';
import { createBankAutoVoucher, createBankAutoVouchers, createOpeningVoucher, readOpeningState, reverseBankAutoVoucher } from '$lib/server/voucher';
import { expectedRentByOwner, setRentFrom } from '$lib/server/rent';
import { ownerLedger } from '$lib/server/balances';
import { landingMembership } from '$lib/server/membership';

const createdOrgs: string[] = [];
const createdUsers: string[] = [];

async function testSameie() {
	const orgId = generateId();
	createdOrgs.push(orgId);
	await db.insert(s.organization).values({ id: orgId, name: `Test ${orgId}`, slug: `test-${orgId}`, createdAt: new Date() });
	await db.insert(s.ledgerAccount).values(DEFAULT_ACCOUNTS.map((a) => ({ id: generateId(), organizationId: orgId, ...a })));
	const accounts = new Map(
		(await db.select({ id: s.ledgerAccount.id, code: s.ledgerAccount.code }).from(s.ledgerAccount).where(eq(s.ledgerAccount.organizationId, orgId))).map((a) => [a.code, a.id])
	);

	return {
		orgId,
		account: (code: string) => accounts.get(code)!,
		async owner(name: string) {
			const id = generateId();
			await db.insert(s.owner).values({ id, organizationId: orgId, name, ownerType: 'PERSON', publicId: `test-${id}` });
			return id;
		},
		async flat(flatNo: string) {
			const id = generateId();
			await db.insert(s.flat).values({ id, organizationId: orgId, nummer: 1, flatNo, shareNumerator: 1, shareDenominator: 1 });
			return id;
		},
		async ownership(flatId: string, ownerId: string, fromDate: string, toDate: string | null = null) {
			await db.insert(s.flatOwnership).values({ id: generateId(), flatId, ownerId, fromDate, toDate, shareNumerator: 1, shareDenominator: 1, isPaymentResponsible: true });
		}
	};
}

afterAll(async () => {
	if (createdUsers.length > 0) await db.delete(s.user).where(inArray(s.user.id, createdUsers));
	if (createdOrgs.length > 0) {
		// Dependency order: an organization delete alone trips voucher_line -> ledger_account
		// (and flat_ownership -> owner, bank_transaction -> voucher), whose foreign keys have no ON DELETE action
		await db.delete(s.bankTransaction).where(inArray(s.bankTransaction.organizationId, createdOrgs));
		await db.delete(s.voucher).where(inArray(s.voucher.organizationId, createdOrgs));
		await db.delete(s.flat).where(inArray(s.flat.organizationId, createdOrgs));
		await db.delete(s.organization).where(inArray(s.organization.id, createdOrgs));
	}
	await db.$client.end();
});

describe('vouchers', () => {
	test('concurrent batches get unique, consecutive numbers and every voucher balances', async () => {
		const t = await testSameie();
		const batch = (prefix: string) =>
			Array.from({ length: 30 }, (_, i) => ({
				bankTransactionId: `${prefix}-${i}`,
				date: '2026-03-01',
				amountOre: i % 2 === 0 ? 100000 : -5000,
				counterAccountId: t.account(i % 2 === 0 ? '3600' : '6340'),
				description: `${prefix} ${i}`
			}));

		// Without the advisory lock both transactions read the same MAX and one fails on the unique index
		await Promise.all([
			db.transaction((tx) => createBankAutoVouchers(tx, t.orgId, batch('a'))),
			db.transaction((tx) => createBankAutoVouchers(tx, t.orgId, batch('b')))
		]);

		const numbers = (await db.select({ n: s.voucher.voucherNumber }).from(s.voucher).where(eq(s.voucher.organizationId, t.orgId))).map((r) => r.n).sort((a, b) => a - b);
		expect(numbers).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));

		const unbalanced = await db.execute(
			sql`select v.id from voucher v join voucher_line l on l.voucher_id = v.id where v.organization_id = ${t.orgId} group by v.id having sum(l.debit_ore) <> sum(l.credit_ore)`
		);
		expect(unbalanced.length).toBe(0);
	});

	test('opening balances survive a round trip, negative ones included', async () => {
		const t = await testSameie();
		const owes = await t.owner('Skylder');
		const prepaid = await t.owner('Forskudd');

		await db.transaction((tx) =>
			createOpeningVoucher(tx, {
				organizationId: t.orgId,
				year: 2026,
				bankOre: -250000,
				loanOre: 500000,
				ownerBalances: [
					{ ownerId: owes, balanceOre: -30000 },
					{ ownerId: prepaid, balanceOre: 45000 }
				]
			})
		);

		const state = await readOpeningState(db, t.orgId, 2026);
		expect(state?.bankOre).toBe(-250000);
		expect(state?.loanOre).toBe(500000);
		expect(new Map(state?.ownerBalances.map((o) => [o.ownerId, o.balanceOre]))).toEqual(
			new Map([
				[owes, -30000],
				[prepaid, 45000]
			])
		);
	});
});

describe('corrections keep posted vouchers', () => {
	const vouchersOf = (orgId: string) =>
		db
			.select({ id: s.voucher.id, n: s.voucher.voucherNumber, source: s.voucher.source, reverses: s.voucher.reversesVoucherId })
			.from(s.voucher)
			.where(eq(s.voucher.organizationId, orgId))
			.orderBy(asc(s.voucher.voucherNumber));
	const netOn = async (orgId: string, code: string, ownerId?: string) => {
		const [row] = await db
			.select({ net: sql<string>`coalesce(sum(${s.voucherLine.debitOre} - ${s.voucherLine.creditOre}), 0)` })
			.from(s.voucherLine)
			.innerJoin(s.voucher, eq(s.voucher.id, s.voucherLine.voucherId))
			.innerJoin(s.ledgerAccount, eq(s.ledgerAccount.id, s.voucherLine.ledgerAccountId))
			.where(and(eq(s.voucher.organizationId, orgId), eq(s.ledgerAccount.code, code), ownerId ? eq(s.voucherLine.ownerId, ownerId) : undefined));
		return Number(row.net);
	};
	const unbalanced = (orgId: string) =>
		db.execute(sql`select v.id from voucher v join voucher_line l on l.voucher_id = v.id where v.organization_id = ${orgId} group by v.id having sum(l.debit_ore) <> sum(l.credit_ore)`);

	test('changing opening balances adds a correction and leaves each account right', async () => {
		const t = await testSameie();
		const owes = await t.owner('Skylder');
		const prepaid = await t.owner('Forskudd');
		const setOpening = (bankOre: number, owesOre: number) =>
			db.transaction((tx) =>
				createOpeningVoucher(tx, {
					organizationId: t.orgId,
					year: 2026,
					bankOre,
					loanOre: 500000,
					ownerBalances: [
						{ ownerId: owes, balanceOre: owesOre },
						{ ownerId: prepaid, balanceOre: 45000 }
					]
				})
			);

		await setOpening(-250000, -30000);
		await setOpening(100000, 20000); // bank changes and the owner goes from owing to prepaid
		await setOpening(100000, 20000); // nothing changes, nothing is posted

		const vouchers = await vouchersOf(t.orgId);
		expect(vouchers.map((v) => [v.n, v.source, v.reverses])).toEqual([
			[1, 'OPENING', null],
			[2, 'OPENING', vouchers[0].id]
		]);
		const state = await readOpeningState(db, t.orgId, 2026);
		expect(state).toMatchObject({ bankOre: 100000, loanOre: 500000 });
		expect(new Map(state?.ownerBalances.map((o) => [o.ownerId, o.balanceOre]))).toEqual(new Map([[owes, 20000], [prepaid, 45000]]));
		expect(await netOn(t.orgId, '1920')).toBe(100000);
		expect(await netOn(t.orgId, '2400')).toBe(-500000);
		expect(await netOn(t.orgId, '1500', owes)).toBe(0);
		expect(await netOn(t.orgId, '2770', owes)).toBe(-20000);
		expect(await netOn(t.orgId, '2770', prepaid)).toBe(-45000);
		expect((await unbalanced(t.orgId)).length).toBe(0);
	});

	test('re-categorising reverses the voucher instead of deleting it', async () => {
		const t = await testSameie();
		const statementId = generateId();
		await db.insert(s.bankStatement).values({ id: statementId, organizationId: t.orgId, fileName: 'test.csv', content: '', importedAt: new Date(), rowCount: 1 });
		const txId = generateId();
		await db.insert(s.bankTransaction).values({ id: txId, organizationId: t.orgId, bankStatementId: statementId, date: '2026-03-10', description: 'Faktura', amountOre: -5000 });
		const categorise = (code: string) =>
			db.transaction(async (tx) => {
				await reverseBankAutoVoucher(tx, txId);
				await createBankAutoVoucher(tx, { organizationId: t.orgId, bankTransactionId: txId, date: '2026-03-10', amountOre: -5000, counterAccountId: t.account(code), description: 'Faktura' });
			});

		await categorise('6340');
		await categorise('6600');

		const vouchers = await vouchersOf(t.orgId);
		expect(vouchers.map((v) => [v.n, v.source, v.reverses])).toEqual([
			[1, 'BANK_AUTO', null],
			[2, 'CORRECTION', vouchers[0].id],
			[3, 'BANK_AUTO', null]
		]);
		const [row] = await db.select({ voucherId: s.bankTransaction.voucherId }).from(s.bankTransaction).where(eq(s.bankTransaction.id, txId));
		expect(row.voucherId).toBe(vouchers[2].id);
		expect(await netOn(t.orgId, '6340')).toBe(0);
		expect(await netOn(t.orgId, '6600')).toBe(5000);
		expect(await netOn(t.orgId, '1920')).toBe(-5000);
		expect((await unbalanced(t.orgId)).length).toBe(0);
	});
});

describe('rent', () => {
	test('a mid-month sale leaves that month with the seller and the rest with the buyer', async () => {
		const t = await testSameie();
		const flatId = await t.flat('H0101');
		const seller = await t.owner('Selger');
		const buyer = await t.owner('Kjøper');
		await t.ownership(flatId, seller, '2020-01-01', '2026-03-15');
		await t.ownership(flatId, buyer, '2026-03-16');
		await db.transaction((tx) => setRentFrom(tx, flatId, 2020, 1, 100000));

		const { expected } = await expectedRentByOwner(t.orgId, 2026, new Date(2026, 8, 14));
		expect(expected.get(seller)).toBe(300000); // Jan-Mar: the seller owns the flat on 1 March
		expect(expected.get(buyer)).toBe(600000); // Apr-Sep

		// Owner balance = opening + payments - expected
		await db.transaction((tx) => createOpeningVoucher(tx, { organizationId: t.orgId, year: 2026, bankOre: 0, loanOre: 0, ownerBalances: [{ ownerId: seller, balanceOre: -20000 }] }));
		await db.transaction((tx) =>
			createBankAutoVouchers(tx, t.orgId, [{ bankTransactionId: 'pay', date: '2026-05-05', amountOre: 700000, counterAccountId: t.account('3600'), ownerId: buyer, description: 'Innbetaling' }])
		);
		const { owners } = await ownerLedger(t.orgId, 2026, new Date(2026, 8, 14));
		const byId = new Map(owners.map((o) => [o.ownerId, o]));
		expect(byId.get(seller)).toMatchObject({ openingOre: -20000, paidOre: 0, expectedOre: 300000, balanceOre: -320000 });
		expect(byId.get(buyer)).toMatchObject({ openingOre: 0, paidOre: 700000, expectedOre: 600000, balanceOre: 100000 });
	});

	test('setRentFrom closes the current rate, corrects the same month, and refuses an earlier one', async () => {
		const t = await testSameie();
		const flatId = await t.flat('H0101');

		await db.transaction((tx) => setRentFrom(tx, flatId, 2025, 1, 100000));
		await db.transaction((tx) => setRentFrom(tx, flatId, 2026, 6, 120000));
		await db.transaction((tx) => setRentFrom(tx, flatId, 2026, 6, 130000));
		await expect(db.transaction((tx) => setRentFrom(tx, flatId, 2026, 1, 90000))).rejects.toMatchObject({ status: 400 });

		const rows = await db
			.select({ fromYear: s.flatRent.fromYear, fromMonth: s.flatRent.fromMonth, toYear: s.flatRent.toYear, toMonth: s.flatRent.toMonth, amount: s.flatRent.amount })
			.from(s.flatRent)
			.where(eq(s.flatRent.flatId, flatId))
			.orderBy(asc(s.flatRent.fromYear), asc(s.flatRent.fromMonth));
		expect(rows).toEqual([
			{ fromYear: 2025, fromMonth: 1, toYear: 2026, toMonth: 5, amount: 100000 },
			{ fromYear: 2026, fromMonth: 6, toYear: null, toMonth: null, amount: 130000 }
		]);
	});
});

describe('landingMembership', () => {
	test('the sameie chosen last while still a member, otherwise the oldest membership', async () => {
		const [older, newer, other] = [await testSameie(), await testSameie(), await testSameie()];
		const userId = generateId();
		createdUsers.push(userId);
		await db.insert(s.user).values({ id: userId, name: 'Test', email: `${userId}@test.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
		const join = (orgId: string, joined: string) => db.insert(s.member).values({ id: generateId(), userId, organizationId: orgId, role: 'member', createdAt: new Date(joined) });
		// Joined in the opposite order of creation, so row order can't pass the test by accident
		await join(newer.orgId, '2025-06-01');
		await join(older.orgId, '2024-01-01');
		const landing = async () => (await landingMembership(userId))?.organizationId;
		const chooseLast = (orgId: string) => db.update(s.user).set({ lastActiveOrganizationId: orgId }).where(eq(s.user.id, userId));

		expect(await landing()).toBe(older.orgId);
		await chooseLast(newer.orgId);
		expect(await landing()).toBe(newer.orgId);
		await chooseLast(other.orgId); // no longer (or never) a member there
		expect(await landing()).toBe(older.orgId);
	});
});
