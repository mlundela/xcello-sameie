// Tenant isolation and member roles against a running app: `bun run test:e2e` while `bun run dev` is
// up (CI starts one, see check.yml). Creates two sameier and three users in the database at
// DATABASE_URL, signs in over HTTP and calls remote functions the way the browser does.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { generateId } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { parse, stringify } from 'devalue';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as s from '$lib/schema';
import { DEFAULT_ACCOUNTS } from '$lib/server/default-accounts';

setDefaultTimeout(60_000); // the dev server compiles each route on first use

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'e2e-password-123';
const run = generateId().slice(0, 8).toLowerCase();
const now = new Date();

const TX = '(auth)/transaksjoner/[year]/banktransaksjoner.remote.ts';
const RULES = '(auth)/matchingsregler/matchingsregler.remote.ts';
const ACCOUNTS = '(auth)/kontoplan/kontoplan.remote.ts';
const RENT = '(auth)/husleie/husleie.remote.ts';
const FLAT = '(auth)/flats/[flatNo]/flat.remote.ts';
const REPORTS = '(auth)/rapporter/rapporter.remote.ts';

async function createSameie(label: string) {
	const orgId = generateId();
	await db.insert(s.organization).values({ id: orgId, name: `E2E ${label} ${run}`, slug: `e2e-${label.toLowerCase()}-${run}`, createdAt: now });
	const accounts = DEFAULT_ACCOUNTS.map((a) => ({ id: generateId(), organizationId: orgId, ...a }));
	await db.insert(s.ledgerAccount).values(accounts);
	await db.insert(s.accountingPeriod).values({ id: generateId(), organizationId: orgId, year: 2026, status: 'OPEN' });

	const ownerId = generateId();
	await db.insert(s.owner).values({ id: ownerId, organizationId: orgId, name: `Eier ${label}`, ownerType: 'PERSON', publicId: `e2e-${ownerId}` });
	const flatId = generateId();
	const flatNo = `${label}0101`;
	await db.insert(s.flat).values({ id: flatId, organizationId: orgId, nummer: 1, flatNo, shareNumerator: 1, shareDenominator: 1 });
	await db.insert(s.flatOwnership).values({ id: generateId(), flatId, ownerId, fromDate: '2020-01-01', toDate: null, shareNumerator: 1, shareDenominator: 1, isPaymentResponsible: true });

	const statementId = generateId();
	await db.insert(s.bankStatement).values({ id: statementId, organizationId: orgId, fileName: 'e2e.csv', content: '', importedAt: now, rowCount: 1 });
	const transactionId = generateId();
	await db.insert(s.bankTransaction).values({ id: transactionId, organizationId: orgId, bankStatementId: statementId, date: '2026-03-01', description: 'E2E', amountOre: -10000 });
	const ruleId = generateId();
	await db.insert(s.matchingRule).values({ id: ruleId, organizationId: orgId, pattern: `E2E ${label}`, ownerId });
	const attachmentId = generateId();
	await db.insert(s.attachment).values({ id: attachmentId, bankTransactionId: transactionId, organizationId: orgId, fileName: 'e2e.pdf', mimeType: 'application/pdf', content: 'JVBERi0=', uploadedAt: now });

	return { orgId, ownerId, flatId, flatNo, transactionId, ruleId, attachmentId, expenseAccountId: accounts.find((a) => a.code === '6340')!.id };
}

const userIds: string[] = [];
async function createUser(label: string, organizationId: string, role: string) {
	const userId = generateId();
	userIds.push(userId);
	const email = `e2e-${label}-${run}@test.invalid`;
	await db.insert(s.user).values({ id: userId, name: `E2E ${label}`, email, emailVerified: true, createdAt: now, updatedAt: now });
	await db.insert(s.account).values({ id: generateId(), userId, accountId: userId, providerId: 'credential', password: await hashPassword(PASSWORD), createdAt: now, updatedAt: now });
	const memberId = generateId();
	await db.insert(s.member).values({ id: memberId, userId, organizationId, role, createdAt: now });
	return { email, memberId };
}

const jsonHeaders = { Origin: BASE, 'Content-Type': 'application/json' };

/** Session cookie; the sign-in hook makes the user's only sameie active */
async function signIn(email: string) {
	const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email, password: PASSWORD }) });
	if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`);
	return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const remoteIds = new Map<string, string>();
/** A remote function's id, read from the module the dev server serves for its file */
async function remoteId(file: string, name: string) {
	if (!remoteIds.has(`${file}#${name}`)) {
		const url = `${BASE}/src/routes/${encodeURI(file).replaceAll('(', '%28').replaceAll(')', '%29')}`;
		for (const [, id, fn] of (await (await fetch(url)).text()).matchAll(/'(\w+\/(\w+))'/g)) remoteIds.set(`${file}#${fn}`, id);
	}
	const id = remoteIds.get(`${file}#${name}`);
	if (!id) throw new Error(`no remote function ${name} in ${file}`);
	return id;
}

type Result = { ok: true; value: unknown } | { ok: false; status: number; message?: string };
type Body = { type: string; status?: number; error?: { message?: string }; data?: string };
const encode = (arg: unknown) => Buffer.from(stringify(arg)).toString('base64url');
const toResult = (body: Body): Result =>
	body.type === 'error' ? { ok: false, status: body.status ?? 0, message: body.error?.message } : { ok: true, value: body.data ? parse(body.data)._ : undefined };

async function command(cookie: string, file: string, name: string, arg: unknown = {}) {
	const res = await fetch(`${BASE}/_app/remote/${await remoteId(file, name)}`, {
		method: 'POST',
		headers: { ...jsonHeaders, cookie },
		body: JSON.stringify({ payload: encode(arg), refreshes: [] })
	});
	return toResult((await res.json()) as Body);
}

async function query(cookie: string, file: string, name: string, arg: unknown) {
	const res = await fetch(`${BASE}/_app/remote/${await remoteId(file, name)}?payload=${encode(arg)}`, { headers: { cookie } });
	return toResult((await res.json()) as Body);
}

let a: Awaited<ReturnType<typeof createSameie>>;
let b: Awaited<ReturnType<typeof createSameie>>;
let adminA: string;
let memberA: string;
let memberAMemberId: string;

beforeAll(async () => {
	a = await createSameie('A');
	b = await createSameie('B');
	const admin = await createUser('admin-a', a.orgId, 'owner');
	const member = await createUser('member-a', a.orgId, 'member');
	await createUser('admin-b', b.orgId, 'owner');
	memberAMemberId = member.memberId;
	adminA = await signIn(admin.email);
	memberA = await signIn(member.email);
});

afterAll(async () => {
	const orgIds = [a?.orgId, b?.orgId].filter((id): id is string => !!id);
	if (orgIds.length > 0) {
		// Dependency order, as in db.test.ts
		await db.delete(s.bankTransaction).where(inArray(s.bankTransaction.organizationId, orgIds));
		await db.delete(s.voucher).where(inArray(s.voucher.organizationId, orgIds));
		await db.delete(s.flat).where(inArray(s.flat.organizationId, orgIds));
		await db.delete(s.organization).where(inArray(s.organization.id, orgIds));
	}
	if (userIds.length > 0) await db.delete(s.user).where(inArray(s.user.id, userIds));
	await db.$client.end();
});

describe("another sameie's data", () => {
	test('is not readable by id', async () => {
		expect(await query(adminA, TX, 'get_transaction', { id: b.transactionId })).toMatchObject({ ok: false, status: 404 });
		expect(await query(adminA, FLAT, 'get_flat', { flatNo: b.flatNo })).toMatchObject({ ok: false, status: 404 });
		expect((await fetch(`${BASE}/vedlegg/${b.attachmentId}`, { headers: { cookie: adminA } })).status).toBe(404);
	});

	test('does not appear in lists', async () => {
		const list = await query(adminA, TX, 'get_transactions', { year: 2026 });
		expect(list.ok).toBe(true);
		const ids = (list.ok ? (list.value as { id: string }[]) : []).map((t) => t.id);
		expect(ids).toContain(a.transactionId);
		expect(ids).not.toContain(b.transactionId);
	});

	test('is not changed by commands given its ids', async () => {
		const refused = [
			[TX, 'categorize_transaction', { transactionId: b.transactionId, ledgerAccountId: a.expenseAccountId }],
			[TX, 'match_transaction', { transactionId: b.transactionId, ownerId: a.ownerId }],
			[ACCOUNTS, 'delete_account', { id: b.expenseAccountId }],
			[RENT, 'set_bulk_rent', { fromYear: 2026, fromMonth: 1, rents: [{ flatId: b.flatId, amountKr: 1 }] }]
		] as const;
		for (const [file, name, arg] of refused) {
			expect({ name, ...(await command(adminA, file, name, arg)) }).toMatchObject({ name, ok: false, status: 404 });
		}

		// These are scoped by the active sameie and simply find nothing
		await command(adminA, RULES, 'delete_rule', { id: b.ruleId });
		await command(adminA, TX, 'update_description', { transactionId: b.transactionId, userDescription: 'endret fra A' });
		await command(adminA, TX, 'delete_attachment', { attachmentId: b.attachmentId });

		const [tx] = await db.select().from(s.bankTransaction).where(eq(s.bankTransaction.id, b.transactionId));
		expect(tx).toMatchObject({ status: 'UNMATCHED', userDescription: null, voucherId: null });
		expect(await db.select().from(s.matchingRule).where(eq(s.matchingRule.id, b.ruleId))).toHaveLength(1);
		expect(await db.select().from(s.attachment).where(eq(s.attachment.id, b.attachmentId))).toHaveLength(1);
		expect(await db.select().from(s.ledgerAccount).where(eq(s.ledgerAccount.id, b.expenseAccountId))).toHaveLength(1);
		expect(await db.select().from(s.flatRent).where(eq(s.flatRent.flatId, b.flatId))).toHaveLength(0);
	});
});

describe('a member', () => {
	test('can read but not change the books', async () => {
		expect(await query(memberA, TX, 'get_transactions', { year: 2026 })).toMatchObject({ ok: true });

		const refused = [
			[TX, 'categorize_transaction', { transactionId: a.transactionId, ledgerAccountId: a.expenseAccountId }],
			[TX, 'update_description', { transactionId: a.transactionId, userDescription: 'endret av medlem' }],
			[ACCOUNTS, 'create_account', { code: '9999', name: 'Medlem', type: 'EXPENSE' }],
			[RULES, 'delete_rule', { id: a.ruleId }],
			[RENT, 'set_bulk_rent', { fromYear: 2026, fromMonth: 1, rents: [{ flatId: a.flatId, amountKr: 1 }] }],
			[REPORTS, 'set_opening_balance', { year: 2026, bankOre: 1, loanOre: 0 }],
			[FLAT, 'set_payment_responsible', { flatNo: a.flatNo, ownerId: a.ownerId }]
		] as const;
		for (const [file, name, arg] of refused) {
			expect({ name, ...(await command(memberA, file, name, arg)) }).toMatchObject({ name, ok: false, status: 403 });
		}

		const [tx] = await db.select().from(s.bankTransaction).where(eq(s.bankTransaction.id, a.transactionId));
		expect(tx).toMatchObject({ status: 'UNMATCHED', userDescription: null });
		expect(await db.select().from(s.matchingRule).where(eq(s.matchingRule.id, a.ruleId))).toHaveLength(1);
	});

	test('can delete a receipt', async () => {
		expect(await command(memberA, TX, 'delete_attachment', { attachmentId: a.attachmentId })).toMatchObject({ ok: true });
		expect(await db.select().from(s.attachment).where(eq(s.attachment.id, a.attachmentId))).toHaveLength(0);
	});

	test('loses access when removed from the sameie', async () => {
		await db.delete(s.member).where(eq(s.member.id, memberAMemberId));
		expect(await query(memberA, TX, 'get_transactions', { year: 2026 })).toMatchObject({ ok: false, status: 403 });
	});
});
