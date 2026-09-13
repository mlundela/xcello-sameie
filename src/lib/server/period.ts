import { and, gte, lt, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** `column` (a date) falls in calendar year `year`. A range rather than EXTRACT(YEAR ...), so an index on the column applies. */
export function inYear(column: PgColumn, year: number): SQL {
	return and(gte(column, `${year}-01-01`), lt(column, `${year + 1}-01-01`))!;
}
