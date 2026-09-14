import { error } from '@sveltejs/kit';
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { requireSession } from '$lib/server/tenant';
import { invitation, organization } from '$lib/schema';
import { eq } from 'drizzle-orm';

export const get_invitation = query(
	v.object({ id: v.string() }),
	async ({ id }) => {
		const [inv] = await db.select().from(invitation).where(eq(invitation.id, id));
		if (!inv) error(404, 'Invitasjonen finnes ikke');

		// Public page: the visitor may be signed out, or signed in with another address
		const signedInEmail = getRequestEvent().locals.session?.user.email ?? null;

		if (inv.status !== 'pending' || inv.expiresAt < new Date()) {
			return { expired: true, status: inv.status, invitation: null, signedInEmail };
		}

		const [org] = await db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, inv.organizationId));

		return {
			expired: false,
			status: inv.status,
			invitation: {
				id: inv.id,
				email: inv.email,
				role: inv.role ?? 'member',
				organizationName: org?.name ?? 'et sameie'
			},
			signedInEmail
		};
	}
);

export const accept_invitation = command(
	v.object({ invitationId: v.string() }),
	async ({ invitationId }) => {
		const session = requireSession();
		const [inv] = await db.select({ email: invitation.email }).from(invitation).where(eq(invitation.id, invitationId));
		if (!inv) error(404, 'Invitasjonen finnes ikke');
		// better-auth refuses this too, but in English
		if (inv.email.toLowerCase() !== session.user.email.toLowerCase()) {
			error(403, `Invitasjonen er sendt til ${inv.email}. Logg inn med den adressen for å godta den.`);
		}
		await auth.api.acceptInvitation({
			body: { invitationId },
			headers: getRequestEvent().request.headers
		});
	}
);
