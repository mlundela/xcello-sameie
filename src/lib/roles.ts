// Stored role values come from better-auth's organization plugin; only the labels are Norwegian.
const ROLE_LABELS: Record<string, string> = { owner: 'Eier', admin: 'Administrator', member: 'Medlem' };

export function roleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role;
}

/**
 * Owners and administrators may change anything. Members can read everything and upload receipts.
 * better-auth stores multiple roles comma-separated.
 */
export function canEdit(role: string | null | undefined): boolean {
	return !!role && role.split(',').some((r) => r === 'owner' || r === 'admin');
}
