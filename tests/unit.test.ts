// Pure logic: no database queries (the modules still read DATABASE_URL when imported).
import { describe, expect, test } from 'bun:test';
import { formatKr, krToOre } from '$lib/money';
import { findRule, type Rule } from '$lib/server/matching';
import { monthsDue, rentForMonth } from '$lib/server/rent';
import { safeNext } from '$lib/next';
import { canEdit } from '$lib/roles';
import { receiptType } from '$lib/server/receipt';

const plain = (s: string) => s.replaceAll('\u00a0', ' ');

describe('formatKr', () => {
	test('formats øre with thousands separators and decimals', () => {
		expect(plain(formatKr(123450))).toBe('1 234,50 kr');
		expect(plain(formatKr(0))).toBe('0,00 kr');
		expect(plain(formatKr(100000000, { decimals: false }))).toBe('1 000 000 kr');
	});

	test('truncates negative amounts toward zero (was one krone off with Math.floor)', () => {
		expect(plain(formatKr(-15050))).toBe('-150,50 kr');
		expect(plain(formatKr(-15050, { decimals: false }))).toBe('-150 kr');
		expect(plain(formatKr(-1, { decimals: false }))).toBe('0 kr');
		expect(plain(formatKr(-1))).toBe('-0,01 kr');
	});

	test('uses no-break spaces, which the PDF font can render', () => {
		expect(formatKr(123450)).toBe('1\u00a0234,50\u00a0kr');
	});
});

describe('krToOre', () => {
	test('parses Norwegian and plain input', () => {
		expect(krToOre('1 234,50')).toBe(123450);
		expect(krToOre('-500')).toBe(-50000);
		expect(krToOre('0,1')).toBe(10);
	});

	test('treats blank and invalid input as 0', () => {
		expect(krToOre('')).toBe(0);
		expect(krToOre('abc')).toBe(0);
	});
});

describe('findRule', () => {
	const rule = (pattern: string, target: 'owner' | 'account'): Rule => ({
		pattern,
		ownerId: target === 'owner' ? `owner:${pattern}` : null,
		ledgerAccountId: target === 'account' ? `account:${pattern}` : null,
		receiptNotRequired: false,
		userDescription: null
	});

	test('the longest matching pattern wins, whatever the rule order', () => {
		const rules = [rule('Kari Hansen', 'owner'), rule('Kari Hansen Strøm', 'account')];
		expect(findRule(rules, 'Kari Hansen Strøm faktura', -30000)?.pattern).toBe('Kari Hansen Strøm');
		expect(findRule([...rules].reverse(), 'Kari Hansen Strøm faktura', -30000)?.pattern).toBe('Kari Hansen Strøm');
	});

	test('account rules only apply to outgoing payments', () => {
		const rules = [rule('Kari Hansen', 'owner'), rule('Kari Hansen Strøm', 'account')];
		expect(findRule(rules, 'Kari Hansen Strøm refusjon', 10000)?.pattern).toBe('Kari Hansen');
		expect(findRule([rule('Hafslund', 'account')], 'Hafslund tilbakebetaling', 5000)).toBeUndefined();
	});

	test('owner rules match refunds as well as payments', () => {
		expect(findRule([rule('Ola Hansen', 'owner')], 'Tilbakebetaling Ola Hansen', -20000)?.ownerId).toBe('owner:Ola Hansen');
	});

	test('matching ignores case', () => {
		expect(findRule([rule('ola hansen', 'owner')], 'INNBETALING OLA HANSEN', 300000)).toBeDefined();
	});

	test('equal-length patterns are ordered alphabetically, not by row order', () => {
		const rules = [rule('Nilsen B', 'owner'), rule('Nilsen A', 'owner')];
		expect(findRule(rules, 'Nilsen A Nilsen B', 1000)?.pattern).toBe('Nilsen A');
		expect(findRule([...rules].reverse(), 'Nilsen A Nilsen B', 1000)?.pattern).toBe('Nilsen A');
	});

	test('no applicable rule gives undefined', () => {
		expect(findRule([rule('Hafslund', 'account')], 'Gjensidige', -9500)).toBeUndefined();
	});
});

describe('rentForMonth and monthsDue', () => {
	const rents = [
		{ flatId: 'f1', fromYear: 2025, fromMonth: 1, toYear: 2026, toMonth: 6, amount: 300000 },
		{ flatId: 'f1', fromYear: 2026, fromMonth: 7, toYear: null, toMonth: null, amount: 315000 },
		{ flatId: 'f2', fromYear: 2026, fromMonth: 3, toYear: null, toMonth: null, amount: 200000 }
	];

	test('picks the rate in effect for the month', () => {
		expect(rentForMonth(rents, 'f1', 2026, 6)).toBe(300000);
		expect(rentForMonth(rents, 'f1', 2026, 7)).toBe(315000);
		expect(rentForMonth(rents, 'f1', 2030, 1)).toBe(315000);
	});

	test('is 0 before the first rate or for another flat', () => {
		expect(rentForMonth(rents, 'f2', 2026, 2)).toBe(0);
		expect(rentForMonth(rents, 'f3', 2026, 5)).toBe(0);
	});

	test('counts all months for past years, none for future ones', () => {
		const today = new Date(2026, 8, 14);
		expect(monthsDue(2025, today)).toBe(12);
		expect(monthsDue(2026, today)).toBe(9);
		expect(monthsDue(2027, today)).toBe(0);
	});
});

describe('safeNext', () => {
	test('keeps same-site paths', () => {
		expect(safeNext('/invite/abc')).toBe('/invite/abc');
	});

	test('rejects other hosts and missing values', () => {
		expect(safeNext('//evil.example')).toBe('/dashboard');
		expect(safeNext('/\\evil.example')).toBe('/dashboard');
		expect(safeNext('https://evil.example')).toBe('/dashboard');
		expect(safeNext(null)).toBe('/dashboard');
	});
});

describe('receiptType', () => {
	const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

	test('recognises PDF, JPEG, PNG and WebP by their signatures', () => {
		expect(receiptType(bytes('%PDF-1.7\n'))).toBe('application/pdf');
		expect(receiptType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(receiptType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
		expect(receiptType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
	});

	test('rejects other content, whatever it is called', () => {
		expect(receiptType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
		expect(receiptType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
		expect(receiptType(new Uint8Array())).toBeNull();
	});
});

describe('canEdit', () => {
	test('owners and admins can edit, members cannot', () => {
		expect(canEdit('owner')).toBe(true);
		expect(canEdit('admin')).toBe(true);
		expect(canEdit('member')).toBe(false);
		expect(canEdit(null)).toBe(false);
	});

	test('handles better-auth comma-separated roles', () => {
		expect(canEdit('member,admin')).toBe(true);
	});
});
