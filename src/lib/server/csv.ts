import { error } from '@sveltejs/kit';

// Bank statement CSV parsing for the four Norwegian formats import_csv accepts. Pure functions,
// so they can be tested against the sample exports in csv/ and spv-*.csv.

export type ParsedRow = { date: string; description: string; amountOre: number };

/** UTF-8, unless that produces replacement characters and latin1 yields real æøå (a Windows-1252 export). */
export function decodeBuffer(buf: Buffer): string {
	const utf8 = buf.toString('utf-8');
	if (!utf8.includes('�')) return utf8;
	// Only use latin1 if it actually produces valid Norwegian characters (real Windows-1252 file)
	const latin1 = buf.toString('latin1');
	return /[æøåÆØÅ]/.test(latin1) ? latin1 : utf8;
}

function splitLine(line: string, sep: string): string[] {
	if (!line.includes('"')) return line.split(sep).map((s) => s.trim());
	const result: string[] = [];
	let inQuote = false;
	let current = '';
	for (const c of line) {
		if (c === '"') {
			inQuote = !inQuote;
		} else if (c === sep && !inQuote) {
			result.push(current.trim());
			current = '';
		} else {
			current += c;
		}
	}
	result.push(current.trim());
	return result;
}

function parseAmount(s: string): number | null {
	const cleaned = s.trim().replace(/\s/g, '');
	if (!cleaned) return null;
	// Norwegian format (8.758,00): remove dot thousands sep, replace comma decimal
	// US/plain format (41002.32): parse as-is
	const normalized = cleaned.includes(',')
		? cleaned.replace(/\./g, '').replace(',', '.')
		: cleaned;
	const val = parseFloat(normalized);
	return isNaN(val) ? null : val;
}

function fromDDMMYYYY(s: string): string {
	const [d, m, y] = s.trim().split('.');
	return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function fromMMDDYYYY(s: string): string {
	const [m, d, y] = s.trim().split('/');
	return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const DATE_DDMMYYYY = /^\d{2}\.\d{2}\.\d{4}/;
const DATE_MMDDYYYY = /^\d{1,2}\/\d{1,2}\/\d{4}/;

function parseBNBank(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const inn = parseAmount(cols[10]);
			const ut = parseAmount(cols[11]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[3], amountOre: Math.round(amount * 100) }];
		});
}

function parseDNB(lines: string[]): ParsedRow[] {
	// 4 metadata lines, header on line 4, data from line 5
	return lines
		.slice(5)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const ut = parseAmount(cols[5]);
			const inn = parseAmount(cols[6]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[1], amountOre: Math.round(amount * 100) }];
		});
}

function parseSparebank1(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ',');
			if (!DATE_MMDDYYYY.test(cols[0])) return [];
			const inn = parseAmount(cols[3]);
			const ut = parseAmount(cols[4]);
			const amount = inn ?? ut;
			if (amount === null) return [];
			return [{ date: fromMMDDYYYY(cols[0]), description: cols[1], amountOre: Math.round(amount * 100) }];
		});
}

function parseSparebankenVest(lines: string[]): ParsedRow[] {
	return lines
		.slice(1)
		.filter((l) => l.trim())
		.flatMap((line) => {
			const cols = splitLine(line, ';');
			if (!DATE_DDMMYYYY.test(cols[0])) return [];
			const amount = parseAmount(cols[6]);
			if (amount === null) return [];
			return [{ date: fromDDMMYYYY(cols[0]), description: cols[4], amountOre: Math.round(amount * 100) }];
		});
}

/** Detects the bank from the header and parses the rows. Throws a Norwegian 400 for unknown formats. */
export function detectAndParse(decoded: string): ParsedRow[] {
	const text = decoded.replace(/^﻿/, ''); // strip BOM
	const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const first = lines[0] ?? '';
	// Split on first separator to get the first field (ASCII-stable even when ø/æ/å is garbled)
	const firstField = first.split(first.includes(',') ? ',' : ';')[0].trim();

	if (first.startsWith('Dato,')) return parseSparebank1(lines);
	if (first.includes('"Konto"')) return parseDNB(lines);
	// SPV: Bokfø rt ... (first field starts with "Bokf")
	if (firstField.startsWith('Bokf') || first.includes('Beløp (NOK)')) return parseSparebankenVest(lines);
	// BN Bank: Utfø rt dato ... (first field starts with "Utf")
	if (firstField.startsWith('Utf')) return parseBNBank(lines);

	error(400, 'Ukjent bankformat');
}
