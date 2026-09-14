// The four bank formats import_csv accepts, parsed from the real sample exports in the repo.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { decodeBuffer, detectAndParse } from '$lib/server/csv';

const parse = (file: string) => detectAndParse(decodeBuffer(readFileSync(file)));

// rows, incoming, outgoing, sum of amounts (øre), first row
const samples: [file: string, rows: number, incoming: number, sumOre: number, first: { date: string; description: string; amountOre: number }][] = [
	['csv/bn.csv', 44, 34, 1061431, { date: '2025-01-30', description: 'FILIAL AF BANKING CIRCLE', amountOre: 4100232 }],
	['csv/dnb.csv', 84, 41, 2065341, { date: '2025-04-01', description: 'Turid Elisabeth Hansen', amountOre: 875800 }],
	['csv/sp1.csv', 303, 52, -1018727, { date: '2024-12-31', description: 'MOBILGIRO M/KID FORF. I DAG 1 TRANS(ER) TYPE 261', amountOre: -300 }],
	['csv/spv.csv', 49, 35, 444250, { date: '2025-10-28', description: 'Polisenummer_SP0000609890', amountOre: -1833500 }],
	['spv-1.csv', 6, 3, -1112800, expect.objectContaining({ date: '2025-01-31', amountOre: -300 })],
	['spv-2.csv', 11, 7, 1356700, expect.objectContaining({ date: '2025-02-17', amountOre: 1800000 })],
	['spv-3.csv', 14, 10, 2026700, expect.objectContaining({ date: '2025-03-03', amountOre: 210000 })]
];

describe('detectAndParse', () => {
	for (const [file, rows, incoming, sumOre, first] of samples) {
		test(`${file}: ${rows} rows with signed øre amounts`, () => {
			const parsed = parse(file);
			expect(parsed).toHaveLength(rows);
			expect(parsed.filter((r) => r.amountOre > 0)).toHaveLength(incoming);
			expect(parsed.reduce((s, r) => s + r.amountOre, 0)).toBe(sumOre);
			expect(parsed[0]).toEqual(first);
			for (const r of parsed) {
				expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(Number.isInteger(r.amountOre)).toBe(true);
			}
		});
	}

	test('keeps Norwegian letters from Sparebanken Vest exports', () => {
		expect(parse('csv/spv.csv').some((r) => /[æøå]/i.test(r.description))).toBe(true);
	});

	test('rejects an unknown format with a Norwegian 400', () => {
		expect(() => detectAndParse('Foo;Bar\n1;2')).toThrow(expect.objectContaining({ status: 400, body: { message: 'Ukjent bankformat' } }));
	});
});
