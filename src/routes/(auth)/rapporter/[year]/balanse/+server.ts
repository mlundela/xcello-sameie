import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import {
	bankTransaction,
	ledgerAccount,
	organization,
	owner,
	flatOwnership,
	flat,
	flatRent,
	voucher,
	voucherLine
} from '$lib/schema';
import { eq, and, sql, sum, isNull, or, gte, inArray } from 'drizzle-orm';
import { createRequire } from 'module';
const pdfmake = createRequire(import.meta.url)('pdfmake');

pdfmake.addFonts({
	Helvetica: {
		normal: 'Helvetica',
		bold: 'Helvetica-Bold',
		italics: 'Helvetica-Oblique',
		bolditalics: 'Helvetica-BoldOblique'
	}
});

function ore(val: string | null): number {
	return parseInt(val ?? '0');
}

function formatKr(oreVal: number): string {
	const sign = oreVal < 0 ? '-' : '';
	const abs = Math.abs(oreVal);
	const kr = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	const øre = (abs % 100).toString().padStart(2, '0');
	return `${sign}${kr},${øre} kr`;
}

function findRentForMonth(
	rents: { flatId: string; fromYear: number; fromMonth: number; toYear: number | null; toMonth: number | null; amount: number }[],
	flatId: string,
	year: number,
	month: number
): number {
	const rent = rents.find((r) => {
		if (r.flatId !== flatId) return false;
		const fromOk = r.fromYear < year || (r.fromYear === year && r.fromMonth <= month);
		const toOk =
			r.toYear === null ||
			r.toYear > year ||
			(r.toYear === year && r.toMonth !== null && r.toMonth >= month);
		return fromOk && toOk;
	});
	return rent?.amount ?? 0;
}

function sectionLayout(bodyLength: number) {
	return {
		hLineWidth: (i: number) => (i === 1 || i === bodyLength - 1) ? 0.5 : 0,
		vLineWidth: () => 0,
		hLineColor: () => '#000000',
		paddingTop: (i: number) => (i === 1 || i === bodyLength - 1) ? 8 : 4,
		paddingBottom: () => 4
	};
}

export const GET: RequestHandler = async ({ params }) => {
	const orgId = requireOrgId();

	const year = parseInt(params.year);
	if (isNaN(year)) throw error(400, 'Ugyldig år');

	const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));

	// Require opening balance voucher
	const [openingVoucher] = await db
		.select({ id: voucher.id })
		.from(voucher)
		.where(and(eq(voucher.organizationId, orgId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING')))
		.limit(1);
	if (!openingVoucher) throw error(400, `Ingen inngående saldo registrert for ${year}. Legg den inn på rapporter-siden.`);

	const today = new Date();
	const monthsToCount = year < today.getFullYear() ? 12 : today.getMonth() + 1;

	const fiscalYearFilter = and(
		eq(voucher.organizationId, orgId),
		eq(voucher.fiscalYear, year)
	);

	// --- Bank closing: opening (fra OPENING-bilag) + alle bank-bevegelser (også ukategoriserte) ---
	// Bankbalansen reflekterer fysisk pengeflyt uavhengig av bokføringsstatus.
	const [openingBankLine] = await db
		.select({ debitOre: voucherLine.debitOre })
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
		.where(and(eq(voucher.organizationId, orgId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING'), eq(ledgerAccount.code, '1920')))
		.limit(1);
	const [bankRow] = await db
		.select({ total: sum(bankTransaction.amountOre) })
		.from(bankTransaction)
		.where(
			and(
				eq(bankTransaction.organizationId, orgId),
				sql`EXTRACT(YEAR FROM ${bankTransaction.date}::date) = ${year}`
			)
		);
	const bankClosing = (openingBankLine?.debitOre ?? 0) + ore(bankRow?.total ?? null);

	// --- Loan closing (2400): aggregerer alle bilagslinjer inkl. OPENING ---
	const [loanRow] = await db
		.select({
			delta: sql<string>`COALESCE(SUM(${voucherLine.creditOre}) - SUM(${voucherLine.debitOre}), 0)`
		})
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
		.where(and(fiscalYearFilter, eq(ledgerAccount.code, '2400')));
	const loanClosing = ore(loanRow?.delta ?? null);

	// --- Fordring / forhåndsbetalt per eier ---
	const ownerships = await db
		.select({
			ownerId: owner.id,
			flatId: flat.id,
			flatNo: flat.flatNo,
			fromDate: flatOwnership.fromDate,
			toDate: flatOwnership.toDate
		})
		.from(flatOwnership)
		.innerJoin(flat, eq(flat.id, flatOwnership.flatId))
		.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(
			and(
				eq(flat.organizationId, orgId),
				eq(flatOwnership.isPaymentResponsible, true),
				or(isNull(flatOwnership.toDate), gte(flatOwnership.toDate, `${year}-01-01`))
			)
		);

	const flatIds = [...new Set(ownerships.map((o) => o.flatId))];
	const rents = flatIds.length > 0
		? await db
			.select({
				flatId: flatRent.flatId,
				fromYear: flatRent.fromYear,
				fromMonth: flatRent.fromMonth,
				toYear: flatRent.toYear,
				toMonth: flatRent.toMonth,
				amount: flatRent.amount
			})
			.from(flatRent)
			.where(inArray(flatRent.flatId, flatIds))
		: [];

	// Per-owner expected for this year
	const ownerIds = [...new Set(ownerships.map((o) => o.ownerId))];
	const expectedPerOwner = new Map<string, number>();
	for (const o of ownerships) {
		let expected = expectedPerOwner.get(o.ownerId) ?? 0;
		for (let m = 1; m <= monthsToCount; m++) {
			expected += findRentForMonth(rents, o.flatId, year, m);
		}
		expectedPerOwner.set(o.ownerId, expected);
	}

	// Per-owner: alle bilagslinjer med ownerId inkl. OPENING-bilag (åpningsbalanse)
	// OPENING-bilagets 1500-linjer (debet) gir negativt bidrag = fordring ved årets start
	// OPENING-bilagets 2770-linjer (kredit) gir positivt bidrag = forhåndsbetalt ved årets start
	const paymentRows = ownerIds.length > 0
		? await db
			.select({
				ownerId: voucherLine.ownerId,
				total: sql<string>`COALESCE(SUM(${voucherLine.creditOre}) - SUM(${voucherLine.debitOre}), 0)`
			})
			.from(voucherLine)
			.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
			.where(and(fiscalYearFilter, inArray(voucherLine.ownerId, ownerIds)))
			.groupBy(voucherLine.ownerId)
		: [];
	const actualPerOwner = new Map(paymentRows.map((r) => [r.ownerId, ore(r.total)]));

	// Compute closing balance per owner, aggregate fordring/forhåndsbetalt
	let fordringClosing = 0;
	let forhåndsClosing = 0;
	for (const ownerId of ownerIds) {
		const expectedO = expectedPerOwner.get(ownerId) ?? 0;
		const actualO = actualPerOwner.get(ownerId) ?? 0;
		const closingO = actualO - expectedO;
		if (closingO < 0) fordringClosing += Math.abs(closingO);
		else if (closingO > 0) forhåndsClosing += closingO;
	}

	// --- Egenkapital ---
	const sumEiendeler = bankClosing + fordringClosing;
	const sumGjeld = forhåndsClosing + loanClosing;
	const egenkapital = sumEiendeler - sumGjeld;

	// --- PDF ---
	const COL = [36, '*', 100];

	const sectionHeader = (label: string) => [
		{ text: label, bold: true, fontSize: 8, colSpan: 2 },
		{},
		{ text: 'BELØP', bold: true, fontSize: 8, alignment: 'right', noWrap: true }
	];

	const dataRow = (code: string, name: string, oreVal: number) => [
		{ text: code, fontSize: 9 },
		{ text: name },
		{ text: formatKr(oreVal), alignment: 'right' }
	];

	const sumRow = (label: string, oreVal: number) => [
		{ text: label, bold: true, colSpan: 2 }, {},
		{ text: formatKr(oreVal), bold: true, alignment: 'right' }
	];

	const eiendelRows = [
		dataRow('1920', 'Bankkonto', bankClosing),
		...(fordringClosing !== 0 ? [dataRow('1500', 'Fordring på eiere', fordringClosing)] : [])
	];

	const gjeldRows = [
		...(forhåndsClosing !== 0 ? [dataRow('2770', 'Forhåndsbetalt fellesutgifter', forhåndsClosing)] : []),
		...(loanClosing !== 0 ? [dataRow('2400', 'Langsiktig gjeld', loanClosing)] : [])
	];

	const eiendelBody = [sectionHeader('EIENDELER'), ...eiendelRows, sumRow('Sum eiendeler', sumEiendeler)];
	const gjeldBody = gjeldRows.length > 0
		? [sectionHeader('GJELD'), ...gjeldRows, sumRow('Sum gjeld', sumGjeld)]
		: [sectionHeader('GJELD'), dataRow('', 'Ingen gjeld', 0), sumRow('Sum gjeld', 0)];

	const egenkapitalBody = [
		sectionHeader('EGENKAPITAL'),
		dataRow('2050', 'Egenkapital', egenkapital),
		sumRow('Sum gjeld og egenkapital', sumGjeld + egenkapital)
	];

	const docDef = {
		pageSize: 'A4',
		defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3 },
		pageMargins: [60, 60, 60, 60],
		content: [
			{ text: (org?.name ?? '').toUpperCase(), fontSize: 8, characterSpacing: 1, margin: [0, 0, 0, 4] },
			{ text: `Balanserapport ${year}`, fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
			{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 1 }], margin: [0, 0, 0, 20] },

			{
				table: { widths: COL, body: eiendelBody },
				layout: sectionLayout(eiendelBody.length),
				margin: [0, 0, 0, 20]
			},
			{
				table: { widths: COL, body: gjeldBody },
				layout: sectionLayout(gjeldBody.length),
				margin: [0, 0, 0, 20]
			},
			{
				table: { widths: COL, body: egenkapitalBody },
				layout: sectionLayout(egenkapitalBody.length),
				margin: [0, 0, 0, 0]
			}
		]
	};

	const buffer: Buffer = await pdfmake.createPdf(docDef).getBuffer();
	const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

	return new Response(arrayBuffer, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="balanserapport-${year}.pdf"`
		}
	});
};
