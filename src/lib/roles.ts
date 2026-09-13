// Stored role values come from better-auth's organization plugin; only the labels are Norwegian.
const ROLE_LABELS: Record<string, string> = { owner: 'Eier', admin: 'Administrator', member: 'Medlem' };

export function roleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role;
}
