import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { formatKr } from '$lib/money';
import { requireOrgId } from '$lib/server/tenant';
import { balanceSheet, syncOpeningBalances } from '$lib/server/balances';
import { organization, voucher } from '$lib/schema';
import { eq, and } from 'drizzle-orm';
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

	await syncOpeningBalances(orgId);

	// Require opening balance voucher
	const [openingVoucher] = await db
		.select({ id: voucher.id })
		.from(voucher)
		.where(and(eq(voucher.organizationId, orgId), eq(voucher.fiscalYear, year), eq(voucher.source, 'OPENING')))
		.limit(1);
	if (!openingVoucher) throw error(400, `Ingen inngående saldo registrert for ${year}. Legg den inn på rapporter-siden.`);

	const sheet = await balanceSheet(orgId, year);

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

	const lines = (rows: { code: string; name: string; amountOre: number }[]) => rows.map((r) => dataRow(r.code, r.name, r.amountOre));

	const eiendelBody = [sectionHeader('EIENDELER'), ...lines(sheet.assets), sumRow('Sum eiendeler', sheet.assetsOre)];
	const gjeldBody = [
		sectionHeader('GJELD'),
		...(sheet.liabilities.length > 0 ? lines(sheet.liabilities) : [dataRow('', 'Ingen gjeld', 0)]),
		sumRow('Sum gjeld', sheet.liabilitiesOre)
	];
	const egenkapitalBody = [
		sectionHeader('EGENKAPITAL'),
		...lines(sheet.equity),
		sumRow('Sum egenkapital', sheet.equityOre),
		sumRow('Sum gjeld og egenkapital', sheet.liabilitiesOre + sheet.equityOre)
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
				layout: sectionLayout(egenkapitalBody.length - 1),
				margin: [0, 0, 0, 0]
			},

			// Shown instead of hidden: the report used to make equity whatever balanced it
			...(sheet.differenceOre !== 0 ? [
				{
					columns: [
						{ text: 'Differanse', bold: true, width: '*' },
						{ text: formatKr(sheet.differenceOre), bold: true, alignment: 'right', width: 120, noWrap: true }
					],
					margin: [0, 20, 0, 4]
				},
				{
					text: 'Eiendeler minus gjeld og egenkapital. Skyldes vanligvis banktransaksjoner som ikke er kategorisert (se resultatregnskapet); kategoriser dem for å få differansen til null.',
					fontSize: 8
				}
			] : [])
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
