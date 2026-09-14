import { and, gte, lt, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** `column` (a date) falls in calendar year `year`. A range rather than EXTRACT(YEAR ...), so an index on the column applies. */
export function inYear(column: PgColumn, year: number): SQL {
	return and(gte(column, `${year}-01-01`), lt(column, `${year + 1}-01-01`))!;
}

/** `column` (a date) falls in `month` (1-12) of `year`. */
export function inMonth(column: PgColumn, year: number, month: number): SQL {
	const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
	return and(gte(column, `${year}-${String(month).padStart(2, '0')}-01`), lt(column, next))!;
}
