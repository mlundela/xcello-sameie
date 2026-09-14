// Every remote function and endpoint must resolve who is asking before touching data. This reads the
// source, so a new command without requireAdmin() (or a query without a tenant check) fails CI.
// e2e/tenant.test.ts checks what the guards actually do against a running app.
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';

const TENANT_GUARD = /\b(requireAdmin|requireOrgId|requireSession|getSessionAndOrg)\(/;

// Mutations members may do (receipts, #18) or that don't act on the active sameie
const MEMBER_COMMANDS = new Set(['upload_attachment', 'delete_attachment', 'leave_organization', 'accept_invitation', 'create_organization']);
// Readable without signing in: the invitation page
const PUBLIC_QUERIES = new Set(['get_invitation']);

/** Each exported query/command/form with the source up to the next export. */
function remoteFunctions() {
	const found: { file: string; name: string; kind: string; body: string }[] = [];
	for (const file of new Glob('src/routes/**/*.remote.ts').scanSync('.')) {
		const source = readFileSync(file, 'utf8');
		const exports = [...source.matchAll(/^export const (\w+) = (query|command|form)\b/gm)];
		exports.forEach((m, i) => {
			found.push({ file, name: m[1], kind: m[2], body: source.slice(m.index, exports[i + 1]?.index ?? source.length) });
		});
	}
	return found;
}

describe('remote function guards', () => {
	const fns = remoteFunctions();

	test('finds the remote functions', () => {
		expect(fns.length).toBeGreaterThan(40);
	});

	test('every command and form calls requireAdmin(), unless members may use it', () => {
		const missing = fns
			.filter((f) => f.kind !== 'query' && !MEMBER_COMMANDS.has(f.name) && !/\brequireAdmin\(/.test(f.body))
			.map((f) => `${f.file}: ${f.name}`);
		expect(missing).toEqual([]);
	});

	test('every remote function checks the session or the active sameie', () => {
		const missing = fns.filter((f) => !PUBLIC_QUERIES.has(f.name) && !TENANT_GUARD.test(f.body)).map((f) => `${f.file}: ${f.name}`);
		expect(missing).toEqual([]);
	});

	test('every endpoint under (auth) checks the active sameie', () => {
		const missing = [...new Glob('src/routes/(auth)/**/+{server,page.server}.ts').scanSync('.')].filter(
			(file) => !TENANT_GUARD.test(readFileSync(file, 'utf8'))
		);
		expect(missing).toEqual([]);
	});
});
