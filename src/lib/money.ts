// Money is integer øre throughout; these are the only conversions to and from text.
// Separators are U+00A0 (no-break space): it keeps "1 234 kr" on one line in HTML and maps to the
// space glyph in pdfkit's WinAnsi encoding, so the PDF reports use the same function. The minus is
// ASCII for the same reason (U+2212, which Intl produces, has no WinAnsi glyph).
const NBSP = '\u00a0';

/** "1 234,50 kr" for 123450 øre. `decimals: false` drops øre, truncating toward zero: -15050 → "-150 kr". */
export function formatKr(ore: number, { decimals = true }: { decimals?: boolean } = {}): string {
	const abs = Math.abs(Math.trunc(ore));
	const kr = Math.floor(abs / 100);
	const sign = ore < 0 && (decimals ? abs : kr) > 0 ? '-' : '';
	const whole = String(kr).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
	const fraction = decimals ? ',' + String(abs % 100).padStart(2, '0') : '';
	return `${sign}${whole}${fraction}${NBSP}kr`;
}

/** Øre from user input such as "1 234,50", "-500" or "12.5". Blank or unparseable input gives 0. */
export function krToOre(input: string): number {
	const value = parseFloat(input.replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
