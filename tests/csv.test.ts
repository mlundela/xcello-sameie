// The four bank formats import_csv accepts. The real exports in csv/ and spv-*.csv are gitignored
// (they hold people's names and account numbers), so these are made-up files with the same layout.
import { describe, expect, test } from 'bun:test';
import { decodeBuffer, detectAndParse } from '$lib/server/csv';

const parse = (text: string) => detectAndParse(decodeBuffer(Buffer.from(text)));

// BN Bank: ';' with padded fields, "Beløp inn"/"Beløp ut" in columns 10/11, ø garbled to U+FFFD in the header
const bn = [
	'Utf�rt dato ; Bokf�rt dato; Rentedato ; Beskrivelse ; Type ; Undertype ; Fra konto ; Avsender ; Til konto ; Mottakernavn ; Bel�p inn; Bel�p ut; Valuta; Status ; Numref ; Arkivref ; Melding/KID/Fakt.nr',
	'30.01.2025 ; 30.01.2025 ; 30.01.2025 ; Kari Nordmann ; Betaling innland; Innlandsbetaling ; 1234 56 78901; Kari Nordmann ; 9876 54 32109; Sameiet ;  4100.32 ; ; NOK ; Bokført; 1 ; 2 ; ',
	'31.01.2025 ; 31.01.2025 ; 31.01.2025 ; Hafslund Strøm ; Betaling innland; Innlandsbetaling ; 9876 54 32109; Sameiet ; 1111 22 33333; Hafslund ; ;  -850.50 ; NOK ; Bokført; 3 ; 4 ; '
].join('\n');

// DNB: four metadata lines, header on line 5, quoted, Norwegian amounts, Ut (column 5) is negative
const dnb = [
	'"Konto";"Kontonavn"',
	'"1234.56.78901";"SAMEIET"',
	'"Inngående saldo";"Utgående saldo";"Sum inn på konto";"Sum ut av konto"',
	'"1.000,00";"8.258,00";"8.758,00";"-1.500,00"',
	'"Bokført dato";"Forklarende tekst";"Status";"Transaksjonstype";"Rentedato";"Ut";"Inn";"Arkivref.";"Referanse"',
	'"01.04.2025";"Ola Nordmann; H0101";"B";"Overføring innland";"01.04.2025";"";"8.758,00";"1";"2"',
	'"02.04.2025";"Renhold AS";"B";"Giro";"02.04.2025";"-1.500,00";"";"3";"4"'
].join('\r\n');

// SpareBank 1: ',' with M/D/YYYY dates and plain amounts
const sp1 = ['Dato,Beskrivelse,Rentedato,Inn,Ut,Til konto,Fra konto', '12/23/2024,Kari Nordmann,,2000,,12345678901,', '1/5/2025,GEBYR 1 TRANS(ER),,,-3,,12345678901'].join('\n');

// Sparebanken Vest: UTF-8 BOM, ';' with padding, signed amount in column 6
const spv = [
	'﻿Bokført ; Rentedato ; Kategori ; Type ; Beskrivelse ; Melding ; Beløp (NOK); Beløp (valuta); Valuta; ',
	'28.10.2025; 28.10.2025; AvtaleGiro ; AVTALEGIRO ; Forsikring Sameie ; ; -18335 ; -18335 ; NOK ; ',
	'01.10.2025; 01.10.2025; Innbetaling; OVERFØRSEL ; Fra: Åse Øvrebø Betalt: 01.10.25 ; Felleskostnader ; 2500,50 ; 2500,50 ; NOK ; '
].join('\n');

describe('detectAndParse', () => {
	test('BN Bank', () => {
		expect(parse(bn)).toEqual([
			{ date: '2025-01-30', description: 'Kari Nordmann', amountOre: 410032 },
			{ date: '2025-01-31', description: 'Hafslund Strøm', amountOre: -85050 }
		]);
	});

	test('DNB, with a separator inside a quoted field and CRLF line endings', () => {
		expect(parse(dnb)).toEqual([
			{ date: '2025-04-01', description: 'Ola Nordmann; H0101', amountOre: 875800 },
			{ date: '2025-04-02', description: 'Renhold AS', amountOre: -150000 }
		]);
	});

	test('SpareBank 1', () => {
		expect(parse(sp1)).toEqual([
			{ date: '2024-12-23', description: 'Kari Nordmann', amountOre: 200000 },
			{ date: '2025-01-05', description: 'GEBYR 1 TRANS(ER)', amountOre: -300 }
		]);
	});

	test('Sparebanken Vest, keeping Norwegian letters', () => {
		expect(parse(spv)).toEqual([
			{ date: '2025-10-28', description: 'Forsikring Sameie', amountOre: -1833500 },
			{ date: '2025-10-01', description: 'Fra: Åse Øvrebø Betalt: 01.10.25', amountOre: 250050 }
		]);
	});

	test('a Windows-1252 export is decoded as latin1', () => {
		const rows = detectAndParse(decodeBuffer(Buffer.from(spv.replace('﻿', ''), 'latin1')));
		expect(rows[1].description).toBe('Fra: Åse Øvrebø Betalt: 01.10.25');
	});

	test('rejects an unknown format with a Norwegian 400', () => {
		expect(() => detectAndParse('Foo;Bar\n1;2')).toThrow(expect.objectContaining({ status: 400, body: { message: 'Ukjent bankformat' } }));
	});
});
