import { error } from '@sveltejs/kit';
import { query, command, getRequestEvent, requested } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { requireAdmin, requireOrgId, requireSession } from '$lib/server/tenant';
import { canEdit } from '$lib/roles';

function getSessionAndOrg() {
	const session = requireSession();
	const orgId = requireOrgId();
	return { session, orgId, headers: getRequestEvent().request.headers };
}

async function getMembers(orgId: string, headers: Headers) {
	const fullOrg = await auth.api.getFullOrganization({ headers, query: { organizationId: orgId } });
	if (!fullOrg) error(404, 'Sameiet finnes ikke');
	return fullOrg;
}

export const get_members_data = query(async () => {
	const { session, orgId, headers } = getSessionAndOrg();
	const fullOrg = await getMembers(orgId, headers);

	const members = fullOrg.members.map((m) => ({
		id: m.id,
		userId: m.userId,
		role: m.role,
		name: m.user.name,
		email: m.user.email
	}));

	const currentMember = fullOrg.members.find((m) => m.userId === session.user.id);
	const pendingInvites = fullOrg.invitations.filter((inv) => inv.status === 'pending');

	return {
		members,
		pendingInvites,
		isAdmin: canEdit(currentMember?.role),
		currentUserId: session.user.id
	};
});

export const invite_member = command(
	v.object({ email: v.string(), role: v.union([v.literal('admin'), v.literal('member')]) }),
	async ({ email, role }) => {
		requireAdmin();
		const { orgId, headers } = getSessionAndOrg();
		await auth.api.createInvitation({
			body: { email, role, organizationId: orgId },
			headers
		});
		await get_members_data().refresh();
	}
);

/**
 * Switches a member between Medlem and Administrator. Ownership isn't changed here, and the last
 * person who can edit can't be demoted, or nobody could change anything in the sameie.
 */
export const update_member_role = command(
	v.object({ memberId: v.pipe(v.string(), v.minLength(1)), role: v.picklist(['member', 'admin']) }),
	async ({ memberId, role }) => {
		requireAdmin();
		const { orgId, headers } = getSessionAndOrg();
		const fullOrg = await getMembers(orgId, headers);

		const target = fullOrg.members.find((m) => m.id === memberId);
		if (!target) error(404, 'Medlemmet finnes ikke');
		if (target.role.split(',').includes('owner')) error(403, 'Eierens rolle kan ikke endres her');
		const editors = fullOrg.members.filter((m) => canEdit(m.role));
		if (role === 'member' && canEdit(target.role) && editors.length === 1) {
			error(409, 'Sameiet må ha minst én administrator');
		}

		await auth.api.updateMemberRole({ body: { memberId, role, organizationId: orgId }, headers });
		await requested(get_members_data, 5).refreshAll();
	}
);

export const remove_member = command(
	v.object({ memberId: v.string() }),
	async ({ memberId }) => {
		requireAdmin();
		const { orgId, headers } = getSessionAndOrg();
		await auth.api.removeMember({
			body: { memberIdOrEmail: memberId, organizationId: orgId },
			headers
		});
		await get_members_data().refresh();
	}
);

export const leave_organization = command(v.object({}), async () => {
	const { session, orgId, headers } = getSessionAndOrg();
	const fullOrg = await getMembers(orgId, headers);

	const editors = fullOrg.members.filter((m) => canEdit(m.role));
	const currentMember = fullOrg.members.find((m) => m.userId === session.user.id);
	if (canEdit(currentMember?.role) && editors.length === 1) {
		error(409, 'Du er eneste administrator. Gi en annen bruker administratorrollen før du forlater sameiet.');
	}

	await auth.api.leaveOrganization({
		body: { organizationId: orgId },
		headers
	});

	const remaining = await auth.api.listOrganizations({ headers });
	await auth.api.setActiveOrganization({
		body: { organizationId: remaining[0]?.id ?? null },
		headers
	});
});

export const cancel_invite = command(
	v.object({ invitationId: v.string() }),
	async ({ invitationId }) => {
		requireAdmin();
		const { headers } = getSessionAndOrg();
		await auth.api.cancelInvitation({
			body: { invitationId },
			headers
		});
		await get_members_data().refresh();
	}
);
