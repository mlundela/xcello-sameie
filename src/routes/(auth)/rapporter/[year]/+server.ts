import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { formatKr } from '$lib/money';
import { requireOrgId } from '$lib/server/tenant';
import { expectedRentByOwner } from '$lib/server/rent';
import { inYear } from '$lib/server/period';
import { bankTransaction, ledgerAccount, organization, voucher, voucherLine } from '$lib/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
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

// Thin line only below header row and above sum row
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

	// Expected 3600 income from rent rates (accrual basis)
	const { expected } = await expectedRentByOwner(orgId, year);
	const expected3600 = [...expected.values()].reduce((s, v) => s + v, 0);

	// Aggregate voucher lines per ledger account for the fiscal year.
	// Net = credit - debit, so INCOME accounts show positive, EXPENSE accounts show negative.
	const accountAgg = await db
		.select({
			code: ledgerAccount.code,
			name: ledgerAccount.name,
			type: ledgerAccount.type,
			totalOre: sql<string>`COALESCE(SUM(${voucherLine.creditOre}) - SUM(${voucherLine.debitOre}), 0)`
		})
		.from(voucherLine)
		.innerJoin(voucher, eq(voucher.id, voucherLine.voucherId))
		.innerJoin(ledgerAccount, eq(ledgerAccount.id, voucherLine.ledgerAccountId))
		.where(
			and(
				eq(voucher.organizationId, orgId),
				eq(voucher.fiscalYear, year),
				inArray(ledgerAccount.type, ['INCOME', 'EXPENSE'])
			)
		)
		.groupBy(ledgerAccount.code, ledgerAccount.name, ledgerAccount.type)
		.orderBy(ledgerAccount.code);

	const inntekter = accountAgg
		.filter((r) => r.type === 'INCOME')
		.map((r) => ({ code: r.code, name: r.name, totalOre: r.totalOre }));
	const utgifter = accountAgg
		.filter((r) => r.type === 'EXPENSE')
		.map((r) => ({ code: r.code, name: r.name, totalOre: r.totalOre }));

	const ukategorisert = await db
		.select({
			date: bankTransaction.date,
			description: bankTransaction.description,
			userDescription: bankTransaction.userDescription,
			amountOre: bankTransaction.amountOre
		})
		.from(bankTransaction)
		.where(
			and(
				eq(bankTransaction.organizationId, orgId),
				inYear(bankTransaction.date, year),
				eq(bankTransaction.status, 'UNMATCHED')
			)
		)
		.orderBy(bankTransaction.date);

	// Replace actual 3600 with expected (accrual basis); keep other income accounts as actual
	const inntekterAdjusted = [
		...(expected3600 > 0 ? [{ code: '3600', name: 'Felleskostnader', totalOre: String(expected3600) }] : []),
		...inntekter.filter((i) => i.code !== '3600')
	];

	const sumInntekter = inntekterAdjusted.reduce((s, r) => s + ore(r.totalOre), 0);
	const sumUtgifter = utgifter.reduce((s, r) => s + ore(r.totalOre), 0);
	const resultat = sumInntekter + sumUtgifter;

	// A4: 595pt wide, margins 60pt each side → content width 475pt
	// Columns: code 36pt | name * | amount 100pt
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

	const inntekterBody = [
		sectionHeader('INNTEKTER'),
		...inntekterAdjusted.map((r) => dataRow(r.code, r.name, ore(r.totalOre))),
		sumRow('Sum inntekter', sumInntekter)
	];

	const utgifterBody = [
		sectionHeader('UTGIFTER'),
		...utgifter.map((r) => dataRow(r.code, r.name, ore(r.totalOre))),
		sumRow('Sum utgifter', sumUtgifter)
	];

	const docDef = {
		pageSize: 'A4',
		defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3 },
		pageMargins: [60, 60, 60, 60],
		content: [
			{ text: (org?.name ?? '').toUpperCase(), fontSize: 8, characterSpacing: 1, margin: [0, 0, 0, 4] },
			{ text: `Resultatregnskap ${year}`, fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
			{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 1 }], margin: [0, 0, 0, 20] },

			{
				table: { widths: COL, body: inntekterBody },
				layout: sectionLayout(inntekterBody.length),
				margin: [0, 0, 0, 20]
			},

			{
				table: { widths: COL, body: utgifterBody },
				layout: sectionLayout(utgifterBody.length),
				margin: [0, 0, 0, 20]
			},

			{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 1 }], margin: [0, 0, 0, 8] },
			{
				columns: [
					{ text: 'Årsresultat', bold: true, fontSize: 12, width: '*' },
					{ text: formatKr(resultat), bold: true, fontSize: 12, alignment: 'right', width: 120, noWrap: true }
				],
				margin: [0, 0, 0, 4]
			},
			{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 0.5 }], margin: [0, 0, 0, 24] },

			...(ukategorisert.length > 0 ? [
				{ text: `Ikke kategorisert (${ukategorisert.length})`, bold: true, fontSize: 8, margin: [0, 0, 0, 6] },
				{
					table: {
						widths: [60, '*', 100],
						body: [
							[
								{ text: 'DATO', bold: true, fontSize: 8 },
								{ text: 'BESKRIVELSE', bold: true, fontSize: 8 },
								{ text: 'BELØP', bold: true, fontSize: 8, alignment: 'right' }
							],
							...ukategorisert.map((tx) => [
								{ text: tx.date, fontSize: 9 },
								{ text: tx.userDescription ?? tx.description, fontSize: 9 },
								{ text: formatKr(tx.amountOre), alignment: 'right', fontSize: 9 }
							])
						]
					},
					layout: {
						hLineWidth: (i: number) => (i === 0 || i === 1) ? 0.5 : 0,
						vLineWidth: () => 0,
						hLineColor: () => '#000000',
						paddingTop: () => 4,
						paddingBottom: () => 4
					}
				}
			] : [])
		]
	};

	const buffer: Buffer = await pdfmake.createPdf(docDef).getBuffer();
	const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

	return new Response(arrayBuffer, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="resultatregnskap-${year}.pdf"`
		}
	});
};
