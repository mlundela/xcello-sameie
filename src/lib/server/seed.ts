// Demo data for local development: `bun run db:seed` (runs through scripts/kit-shim.ts).
//
// Creates "Sameiet Solsiden", a realistic sameie with two accounting years, and the small
// "Sameiet Nabolaget" for checking tenant isolation. Vouchers, rent and rule matching go through
// the same server modules as the app, so the data follows its invariants. Run it against an empty
// database (it applies migrations first); it refuses if the demo sameie already exists.
//
// Logins: admin@example.com (owner of Solsiden, admin of Nabolaget) and user@example.com
// (member of Solsiden), both with password "password123".
import '$lib/server/migrate';
import { hashPassword } from 'better-auth/crypto';
import { generateId } from 'better-auth';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as s from '$lib/schema';
import { DEFAULT_ACCOUNTS } from '$lib/server/default-accounts';
import { createBankAutoVouchers, createOpeningVoucher } from '$lib/server/voucher';
import { setRentFrom } from '$lib/server/rent';
import { closingBalances } from '$lib/server/balances';
import { findRule } from '$lib/server/matching';

const now = new Date();
const thisYear = now.getFullYear();
const lastYear = thisYear - 1;
const currentMonth = now.getMonth() + 1;
const date = (year: number, month: number, day: number) =>
	`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

type OwnerSpec = { name: string; from: string; to?: string; share?: [number, number]; pays?: boolean };
type FlatSpec = { flatNo: string; rentKr: number; owners: OwnerSpec[] };
type SameieSpec = {
	name: string;
	slug: string;
	orgNo: string;
	address: string;
	members: [userId: string, role: string][];
	flats: FlatSpec[];
	/** Rent rises by this factor from July this year */
	rentIncrease?: number;
	opening: { bankKr: number; loanKr: number; owners: [name: string, balanceKr: number][] };
	expenseRules: [pattern: string, accountCode: string][];
	/** Monthly and quarterly costs as [description, amount kr, months] */
	costs: [description: string, amountKr: number, months: number[]][];
	/** "Owner name:year-month" payments that never came */
	missedPayments?: string[];
	/** Transactions no rule matches, left for categorising in the app */
	uncategorised?: [year: number, month: number, description: string, amountKr: number][];
};

const [alreadySeeded] = await db.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.slug, 'solsiden'));
if (alreadySeeded) {
	console.log('Demo-data finnes allerede (sameiet "solsiden"). Tøm databasen først.');
	await db.$client.end();
	process.exit(0);
}

async function createUser(name: string, email: string) {
	const [found] = await db.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, email));
	if (found) return found.id;
	const id = generateId();
	await db.insert(s.user).values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now });
	await db.insert(s.account).values({
		id: generateId(),
		userId: id,
		accountId: id,
		providerId: 'credential',
		password: await hashPassword('password123'),
		createdAt: now,
		updatedAt: now
	});
	return id;
}

async function seedSameie(spec: SameieSpec) {
	const orgId = generateId();
	await db.insert(s.organization).values({
		id: orgId,
		name: spec.name,
		slug: spec.slug,
		metadata: JSON.stringify({ orgNo: spec.orgNo, address: spec.address, postalCode: '5003', city: 'Bergen' }),
		createdAt: now
	});
	await db.insert(s.member).values(spec.members.map(([userId, role]) => ({ id: generateId(), userId, organizationId: orgId, role, createdAt: now })));
	await db.insert(s.ledgerAccount).values(DEFAULT_ACCOUNTS.map((a) => ({ id: generateId(), organizationId: orgId, ...a })));
	await db.insert(s.accountingPeriod).values([lastYear, thisYear].map((year) => ({ id: generateId(), organizationId: orgId, year, status: 'OPEN' })));
	const accounts = new Map(
		(await db.select({ id: s.ledgerAccount.id, code: s.ledgerAccount.code }).from(s.ledgerAccount).where(eq(s.ledgerAccount.organizationId, orgId))).map((a) => [a.code, a.id])
	);

	// Flats, owners (each with the name-based matching rule onboarding creates) and ownerships
	const owners = new Map<string, string>();
	const flatIds = new Map<string, string>();
	for (const [i, f] of spec.flats.entries()) {
		const flatId = generateId();
		flatIds.set(f.flatNo, flatId);
		await db.insert(s.flat).values({ id: flatId, organizationId: orgId, nummer: i + 1, flatNo: f.flatNo, shareNumerator: 1, shareDenominator: spec.flats.length });
		for (const o of f.owners) {
			if (!owners.has(o.name)) {
				const ownerId = generateId();
				owners.set(o.name, ownerId);
				await db.insert(s.owner).values({ id: ownerId, organizationId: orgId, name: o.name, ownerType: 'PERSON', publicId: `demo-${spec.slug}-${owners.size}` });
				await db.insert(s.matchingRule).values({ id: generateId(), organizationId: orgId, pattern: o.name, ownerId });
			}
			await db.insert(s.flatOwnership).values({
				id: generateId(),
				flatId,
				ownerId: owners.get(o.name)!,
				fromDate: o.from,
				toDate: o.to ?? null,
				shareNumerator: o.share?.[0] ?? 1,
				shareDenominator: o.share?.[1] ?? 1,
				isPaymentResponsible: o.pays ?? true
			});
		}
	}
	for (const [pattern, code] of spec.expenseRules) {
		await db.insert(s.matchingRule).values({ id: generateId(), organizationId: orgId, pattern, ledgerAccountId: accounts.get(code)!, receiptNotRequired: code === '7770' });
	}

	const rentKr = (f: FlatSpec, year: number, month: number) =>
		spec.rentIncrease && year === thisYear && month >= 7 ? Math.round(f.rentKr * spec.rentIncrease) : f.rentKr;

	await db.transaction(async (tx) => {
		for (const f of spec.flats) {
			await setRentFrom(tx, flatIds.get(f.flatNo)!, lastYear, 1, f.rentKr * 100);
			if (spec.rentIncrease) await setRentFrom(tx, flatIds.get(f.flatNo)!, thisYear, 7, rentKr(f, thisYear, 7) * 100);
		}
		await createOpeningVoucher(tx, {
			organizationId: orgId,
			year: lastYear,
			bankOre: spec.opening.bankKr * 100,
			loanOre: spec.opening.loanKr * 100,
			ownerBalances: spec.opening.owners.map(([name, kr]) => ({ ownerId: owners.get(name)!, balanceOre: kr * 100 }))
		});
	});

	// One bank statement per year, run through rule matching and voucher creation like import_csv
	async function importYear(year: number, lastMonth: number) {
		const rows: { date: string; description: string; amountOre: number }[] = [];
		for (let month = 1; month <= lastMonth; month++) {
			const first = date(year, month, 1);
			for (const f of spec.flats) {
				// Felleskostnader are owed by the payer owning the flat on the 1st (as in $lib/server/rent.ts)
				const payer = f.owners
					.filter((o) => (o.pays ?? true) && o.from <= first && (!o.to || o.to >= first))
					.sort((a, b) => b.from.localeCompare(a.from))[0];
				if (!payer || spec.missedPayments?.includes(`${payer.name}:${year}-${month}`)) continue;
				rows.push({ date: date(year, month, 5), description: `Innbetaling felleskostnader ${payer.name}`, amountOre: rentKr(f, year, month) * 100 });
			}
			for (const [description, amountKr, months] of spec.costs) {
				if (months.includes(month)) rows.push({ date: date(year, month, 20), description: `${description} ${month}/${year}`, amountOre: -amountKr * 100 });
			}
		}
		for (const [y, month, description, amountKr] of spec.uncategorised ?? []) {
			if (y === year && month <= lastMonth) rows.push({ date: date(year, month, 15), description, amountOre: amountKr * 100 });
		}

		const rules = await db
			.select({ pattern: s.matchingRule.pattern, ownerId: s.matchingRule.ownerId, ledgerAccountId: s.matchingRule.ledgerAccountId, receiptNotRequired: s.matchingRule.receiptNotRequired, userDescription: s.matchingRule.userDescription })
			.from(s.matchingRule)
			.where(eq(s.matchingRule.organizationId, orgId));

		await db.transaction(async (tx) => {
			const bankStatementId = generateId();
			await tx.insert(s.bankStatement).values({
				id: bankStatementId,
				organizationId: orgId,
				fileName: `demo-kontoutskrift-${year}.csv`,
				content: '(demo-data)',
				importedAt: now,
				rowCount: rows.length,
				skippedCount: 0
			});
			const transactions = rows.map((r) => {
				const rule = findRule(rules, r.description, r.amountOre);
				return {
					id: generateId(),
					organizationId: orgId,
					bankStatementId,
					...r,
					matchedOwnerId: rule?.ownerId ?? null,
					ledgerAccountId: rule?.ownerId ? accounts.get('3600')! : (rule?.ledgerAccountId ?? null),
					status: rule?.ownerId ? 'MATCHED' : rule ? 'CATEGORIZED' : 'UNMATCHED',
					receiptNotRequired: r.amountOre > 0 || !!rule?.receiptNotRequired
				};
			});
			await tx.insert(s.bankTransaction).values(transactions);
			await createBankAutoVouchers(
				tx,
				orgId,
				transactions
					.filter((t) => t.ledgerAccountId)
					.map((t) => ({ bankTransactionId: t.id, date: t.date, amountOre: t.amountOre, counterAccountId: t.ledgerAccountId!, ownerId: t.matchedOwnerId, description: t.description }))
			);
		});
		return rows.length;
	}

	const lastYearRows = await importYear(lastYear, 12);
	// This year opens with last year's closing balances, as "Start regnskapsår" does
	const closing = await closingBalances(orgId, lastYear);
	await db.transaction((tx) => createOpeningVoucher(tx, { organizationId: orgId, year: thisYear, ...closing }));
	const thisYearRows = await importYear(thisYear, currentMonth);

	const [{ unmatched }] = await db
		.select({ unmatched: db.$count(s.bankTransaction, and(eq(s.bankTransaction.organizationId, orgId), eq(s.bankTransaction.status, 'UNMATCHED'))) })
		.from(s.organization)
		.where(eq(s.organization.id, orgId));
	console.log(`  ${spec.name}: ${spec.flats.length} leiligheter, ${owners.size} eiere, ${lastYearRows + thisYearRows} banktransaksjoner (${unmatched} ukategorisert)`);
}

const adminId = await createUser('Admin User', 'admin@example.com');
const memberId = await createUser('Normal User', 'user@example.com');

console.log('Oppretter demo-data:');
await seedSameie({
	name: 'Sameiet Solsiden',
	slug: 'solsiden',
	orgNo: '999888777',
	address: 'Solsidevegen 12',
	members: [
		[adminId, 'owner'],
		[memberId, 'member']
	],
	flats: [
		{ flatNo: 'H0101', rentKr: 3000, owners: [{ name: 'Ola Hansen', from: '2015-03-01' }] },
		{
			flatNo: 'H0102',
			rentKr: 3000,
			owners: [
				{ name: 'Kari Nilsen', from: '2019-06-01', share: [1, 2] },
				{ name: 'Per Nilsen', from: '2019-06-01', share: [1, 2], pays: false }
			]
		},
		{
			flatNo: 'H0103',
			rentKr: 3500,
			owners: [
				{ name: 'Anne Berg', from: '2012-01-01', to: date(thisYear, 4, 15) },
				{ name: 'Jonas Lie', from: date(thisYear, 4, 16) }
			]
		},
		{ flatNo: 'H0104', rentKr: 2800, owners: [{ name: 'Eva Strand', from: '2020-09-01' }] },
		{ flatNo: 'H0105', rentKr: 4200, owners: [{ name: 'Nordbo Eiendom AS', from: '2018-01-01' }] }
	],
	rentIncrease: 1.05,
	opening: { bankKr: 250_000, loanKr: 1_200_000, owners: [['Eva Strand', -3000], ['Ola Hansen', 1500]] },
	expenseRules: [
		['Hafslund', '6340'],
		['Renholdsfirma', '6360'],
		['Gjensidige', '7500'],
		['Avdrag lån', '2400'],
		['Bankgebyr', '7770']
	],
	costs: [
		['Hafslund strøm fellesareal', 2400, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
		['Renholdsfirma Rent og Pent', 3200, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
		['Gjensidige bygningsforsikring', 9500, [3, 6, 9, 12]],
		['Avdrag lån Sparebanken', 8000, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
		['Bankgebyr', 45, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]
	],
	missedPayments: [`Eva Strand:${thisYear}-2`, `Eva Strand:${thisYear}-3`],
	uncategorised: [
		[lastYear, 8, 'Vipps overføring', 750],
		[thisYear, Math.max(1, currentMonth - 1), 'Kortkjøp Clas Ohlson', -420]
	]
});

await seedSameie({
	name: 'Sameiet Nabolaget',
	slug: 'nabolaget',
	orgNo: '999777666',
	address: 'Nabovegen 3',
	members: [[adminId, 'admin']],
	flats: [{ flatNo: 'H0101', rentKr: 2000, owners: [{ name: 'Liv Nabo', from: '2010-01-01' }] }],
	opening: { bankKr: 50_000, loanKr: 0, owners: [] },
	expenseRules: [['Bankgebyr', '7770']],
	costs: [['Bankgebyr', 45, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]]
});

console.log('Innlogging: admin@example.com og user@example.com, passord "password123"');
await db.$client.end();
