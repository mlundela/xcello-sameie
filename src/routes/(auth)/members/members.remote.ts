import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { requireOrgId, requireSession } from '$lib/server/tenant';

function getSessionAndOrg() {
	const session = requireSession();
	const orgId = requireOrgId();
	return { session, orgId, headers: getRequestEvent().request.headers };
}

export const get_members_data = query(async () => {
	const { session, orgId, headers } = getSessionAndOrg();

	const fullOrg = await auth.api.getFullOrganization({
		headers,
		query: { organizationId: orgId }
	});

	const members = fullOrg!.members.map((m) => ({
		id: m.id,
		userId: m.userId,
		role: m.role,
		name: m.user.name,
		email: m.user.email
	}));

	const currentMember = fullOrg!.members.find((m) => m.userId === session.user.id);
	const pendingInvites = fullOrg!.invitations.filter((inv) => inv.status === 'pending');

	return {
		members,
		pendingInvites,
		isAdmin: currentMember?.role === 'admin' || currentMember?.role === 'owner',
		currentUserId: session.user.id
	};
});

export const invite_member = command(
	v.object({ email: v.string(), role: v.union([v.literal('admin'), v.literal('member')]) }),
	async ({ email, role }) => {
		const { orgId, headers } = getSessionAndOrg();
		await auth.api.createInvitation({
			body: { email, role, organizationId: orgId },
			headers
		});
		await get_members_data().refresh();
	}
);

export const remove_member = command(
	v.object({ memberId: v.string() }),
	async ({ memberId }) => {
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

	const fullOrg = await auth.api.getFullOrganization({
		headers,
		query: { organizationId: orgId }
	});

	const privileged = fullOrg!.members.filter((m) => m.role === 'admin' || m.role === 'owner');
	const currentMember = fullOrg!.members.find((m) => m.userId === session.user.id);
	const isPrivileged = currentMember?.role === 'admin' || currentMember?.role === 'owner';

	if (isPrivileged && privileged.length === 1) {
		return { error: 'You are the only admin. Assign another admin before leaving.' };
	}

	await auth.api.leaveOrganization({
		body: { organizationId: orgId },
		headers
	});

	const remaining = await auth.api.listOrganizations({ headers });
	const nextOrgId = remaining[0]?.id ?? null;

	await auth.api.setActiveOrganization({
		body: { organizationId: nextOrgId },
		headers
	});

	return { error: null };
});

export const cancel_invite = command(
	v.object({ invitationId: v.string() }),
	async ({ invitationId }) => {
		const { headers } = getSessionAndOrg();
		await auth.api.cancelInvitation({
			body: { invitationId },
			headers
		});
		await get_members_data().refresh();
	}
);
