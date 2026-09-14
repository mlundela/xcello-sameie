// Receipts are identified by their first bytes, not by the type or file name the browser sends.

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

const signatures: [type: string, matches: (b: Uint8Array) => boolean][] = [
	['application/pdf', (b) => ascii(b, 0, 5) === '%PDF-'],
	['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
	['image/png', (b) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n'],
	['image/webp', (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP']
];

/** The MIME type of a PDF, JPEG, PNG or WebP file, or null for anything else. */
export function receiptType(bytes: Uint8Array): string | null {
	return signatures.find(([, matches]) => matches(bytes))?.[0] ?? null;
}
