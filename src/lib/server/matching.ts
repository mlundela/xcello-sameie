import { and, eq, sql } from 'drizzle-orm';
import { generateId } from 'better-auth';
import { db } from './db';
import { matchingRule } from '$lib/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Rule = {
	pattern: string;
	ownerId: string | null;
	ledgerAccountId: string | null;
	receiptNotRequired: boolean;
	userDescription: string | null;
};

/**
 * The matching rule for a bank transaction, or undefined.
 *
 * A rule applies when the description contains its pattern, ignoring case. Owner rules cover
 * payments and refunds; account rules only outgoing payments. When several apply, the longest
 * pattern wins ("Kari Hansen Strøm" beats "Kari"), and equal lengths fall back to alphabetical
 * order, so the result never depends on the order rows come out of the database.
 */
export function findRule<R extends Rule>(rules: R[], description: string, amountOre: number): R | undefined {
	const text = description.toLowerCase();
	return rules
		.filter((r) => text.includes(r.pattern.toLowerCase()) && (r.ownerId !== null || (r.ledgerAccountId !== null && amountOre < 0)))
		.sort((a, b) => b.pattern.length - a.pattern.length || a.pattern.localeCompare(b.pattern))[0];
}

/** Creates a rule, or updates the rule with the same pattern: patterns are unique per sameie, ignoring case. */
export async function upsertRule(tx: typeof db | Tx, organizationId: string, rule: Rule) {
	const [existing] = await tx
		.select({ id: matchingRule.id })
		.from(matchingRule)
		.where(and(eq(matchingRule.organizationId, organizationId), sql`lower(${matchingRule.pattern}) = lower(${rule.pattern})`))
		.limit(1);
	const values = { ...rule, userDescription: rule.userDescription || null };
	if (existing) await tx.update(matchingRule).set(values).where(eq(matchingRule.id, existing.id));
	else await tx.insert(matchingRule).values({ id: generateId(), organizationId, ...values });
}
