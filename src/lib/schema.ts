import { pgTable, text, boolean, timestamp, integer, date, uniqueIndex, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull(),
	image: text('image'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),
	// Where the next sign-in lands ($lib/server/membership.ts)
	lastActiveOrganizationId: text('last_active_organization_id').references(() => organization.id, { onDelete: 'set null' })
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	token: text('token').notNull().unique(),
	expiresAt: timestamp('expires_at').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	// Added by the organization plugin
	activeOrganizationId: text('active_organization_id'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at'),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
	scope: text('scope'),
	idToken: text('id_token'),
	password: text('password'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
});

// Organization plugin tables

export const organization = pgTable('organization', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').unique(),
	logo: text('logo'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at').notNull()
});

export const member = pgTable('member', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	role: text('role').notNull(),
	createdAt: timestamp('created_at').notNull()
});

export const flat = pgTable('flat', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	nummer: integer('nummer').notNull(),
	flatNo: text('flat_no').notNull(),
	shareNumerator: integer('share_numerator').notNull(),
	shareDenominator: integer('share_denominator').notNull()
});

export const owner = pgTable('owner', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	ownerType: text('owner_type').notNull().default('PERSON'),
	publicId: text('public_id').notNull()
}, (t) => [uniqueIndex('owner_org_public_id_idx').on(t.organizationId, t.publicId)]);

export const flatOwnership = pgTable('flat_ownership', {
	id: text('id').primaryKey(),
	flatId: text('flat_id')
		.notNull()
		.references(() => flat.id, { onDelete: 'cascade' }),
	ownerId: text('owner_id')
		.notNull()
		.references(() => owner.id),
	fromDate: date('from_date').notNull(),
	toDate: date('to_date'),
	shareNumerator: integer('share_numerator').notNull(),
	shareDenominator: integer('share_denominator').notNull(),
	isPaymentResponsible: boolean('is_payment_responsible').notNull().default(false)
});

export const accountingPeriod = pgTable('accounting_period', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	year: integer('year').notNull(),
	status: text('status').notNull().default('OPEN')
}, (t) => [uniqueIndex('ap_org_year_idx').on(t.organizationId, t.year)]);

export const flatRent = pgTable('flat_rent', {
	id: text('id').primaryKey(),
	flatId: text('flat_id')
		.notNull()
		.references(() => flat.id, { onDelete: 'cascade' }),
	fromYear: integer('from_year').notNull(),
	fromMonth: integer('from_month').notNull(),
	toYear: integer('to_year'),
	toMonth: integer('to_month'),
	amount: integer('amount').notNull()
}, (t) => [
	index('fr_flat_idx').on(t.flatId),
	// A rate can't end before it starts (setRentFrom keeps ranges from overlapping)
	check('fr_range_check', sql`${t.toYear} IS NULL OR ${t.toYear} * 12 + ${t.toMonth} >= ${t.fromYear} * 12 + ${t.fromMonth}`)
]);

export const ledgerAccount = pgTable('ledger_account', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	code: text('code').notNull(),
	name: text('name').notNull(),
	type: text('type').notNull() // 'INCOME' | 'EXPENSE' | 'LIABILITY' | 'ASSET' | 'EQUITY'
}, (t) => [uniqueIndex('la_org_code_idx').on(t.organizationId, t.code)]);

export const matchingRule = pgTable('matching_rule', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	pattern: text('pattern').notNull(),
	ownerId: text('owner_id')
		.references(() => owner.id, { onDelete: 'cascade' }),
	ledgerAccountId: text('ledger_account_id')
		.references(() => ledgerAccount.id, { onDelete: 'cascade' }),
	receiptNotRequired: boolean('receipt_not_required').notNull().default(false),
	userDescription: text('user_description')
}, (t) => [
	index('mr_org_idx').on(t.organizationId),
	// One rule per pattern, ignoring case; see upsertRule in $lib/server/matching.ts
	uniqueIndex('mr_org_pattern_idx').on(t.organizationId, sql`lower(${t.pattern})`)
]);

export const bankStatement = pgTable('bank_statement', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	fileName: text('file_name').notNull(),
	content: text('content').notNull(),
	importedAt: timestamp('imported_at').notNull(),
	rowCount: integer('row_count').notNull(),
	skippedCount: integer('skipped_count').notNull().default(0)
}, (t) => [index('bs_org_idx').on(t.organizationId)]);

// Bilag (voucher) — internt regnskapsbilag generert fra kategoriserings-handlinger.
// Brukerne ser ikke direkte på bilag i denne iterasjonen; rapporter aggregerer fra voucher_line.
export const voucher = pgTable('voucher', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	voucherNumber: integer('voucher_number').notNull(),
	fiscalYear: integer('fiscal_year').notNull(),
	date: date('date').notNull(),
	description: text('description').notNull(),
	source: text('source').notNull().default('BANK_AUTO'), // 'BANK_AUTO' | 'OPENING' | 'CORRECTION' | 'MANUAL'
	// A correction voucher points at the voucher it reverses (the previous OPENING voucher for opening balances)
	reversesVoucherId: text('reverses_voucher_id').references((): AnyPgColumn => voucher.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at').notNull()
}, (t) => [
	uniqueIndex('voucher_org_year_number_idx').on(t.organizationId, t.fiscalYear, t.voucherNumber),
	index('voucher_org_year_idx').on(t.organizationId, t.fiscalYear)
]);

// Debet/kredit-linjer for et bilag. SUM(debitOre) === SUM(creditOre) per voucher.
export const voucherLine = pgTable('voucher_line', {
	id: text('id').primaryKey(),
	voucherId: text('voucher_id')
		.notNull()
		.references(() => voucher.id, { onDelete: 'cascade' }),
	lineNumber: integer('line_number').notNull(),
	ledgerAccountId: text('ledger_account_id')
		.notNull()
		.references(() => ledgerAccount.id),
	debitOre: integer('debit_ore').notNull().default(0),
	creditOre: integer('credit_ore').notNull().default(0),
	ownerId: text('owner_id').references(() => owner.id)
}, (t) => [index('vl_voucher_idx').on(t.voucherId), index('vl_ledger_idx').on(t.ledgerAccountId)]);

export const bankTransaction = pgTable('bank_transaction', {
	id: text('id').primaryKey(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	bankStatementId: text('bank_statement_id')
		.notNull()
		.references(() => bankStatement.id, { onDelete: 'cascade' }),
	date: date('date').notNull(),
	description: text('description').notNull(),
	userDescription: text('user_description'),
	amountOre: integer('amount_ore').notNull(),
	matchedOwnerId: text('matched_owner_id').references(() => owner.id),
	ledgerAccountId: text('ledger_account_id').references(() => ledgerAccount.id),
	status: text('status').notNull().default('UNMATCHED'), // 'UNMATCHED' | 'MATCHED' | 'CATEGORIZED'
	receiptNotRequired: boolean('receipt_not_required').notNull().default(false),
	voucherId: text('voucher_id').references(() => voucher.id, { onDelete: 'set null' })
}, (t) => [index('bt_org_date_idx').on(t.organizationId, t.date)]);


export const attachment = pgTable('attachment', {
	id: text('id').primaryKey(),
	bankTransactionId: text('bank_transaction_id')
		.notNull()
		.references(() => bankTransaction.id, { onDelete: 'cascade' }),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	fileName: text('file_name').notNull(),
	mimeType: text('mime_type').notNull(),
	content: text('content').notNull(), // base64
	uploadedAt: timestamp('uploaded_at').notNull()
}, (t) => [index('att_tx_idx').on(t.bankTransactionId)]);

export const invitation = pgTable('invitation', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	inviterId: text('inviter_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	role: text('role'),
	status: text('status').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').notNull()
});
