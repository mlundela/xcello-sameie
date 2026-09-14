import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import { roleLabel } from '$lib/roles';

if (!building) {
	if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
	// Must be on a domain verified in Resend: the shared onboarding@resend.dev sender only
	// delivers to the Resend account owner, so signup verification and invites fail for everyone else
	if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not set');
}

// Created on first use: the Resend constructor throws without a key, which breaks the build
let resend: Resend | undefined;
const client = () => (resend ??= new Resend(env.RESEND_API_KEY));


// Names come from signup and org creation forms; without escaping they inject markup into the email
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendVerificationEmail(opts: { to: string; url: string }) {
	await client().emails.send({
		from: env.EMAIL_FROM!,
		to: opts.to,
		subject: 'Bekreft e-postadressen din',
		html: `
			<p>Hei,</p>
			<p>Klikk lenken nedenfor for å bekrefte e-postadressen din:</p>
			<p><a href="${opts.url}">Bekreft e-post</a></p>
			<p>Lenken utløper etter 24 timer.</p>
		`
	});
}

export async function sendInviteEmail(opts: {
	to: string;
	organizationName: string;
	inviterName: string;
	role: string;
	acceptUrl: string;
}) {
	await client().emails.send({
		from: env.EMAIL_FROM!,
		to: opts.to,
		subject: `Du er invitert til ${opts.organizationName}`,
		html: `
			<p>Hei,</p>
			<p><strong>${escapeHtml(opts.inviterName)}</strong> har invitert deg til
			<strong>${escapeHtml(opts.organizationName)}</strong> som <em>${escapeHtml(roleLabel(opts.role).toLowerCase())}</em>.</p>
			<p><a href="${opts.acceptUrl}">Godta invitasjonen</a></p>
			<p>Lenken utløper etter 48 timer.</p>
		`
	});
}

export async function sendPasswordResetEmail(opts: { to: string; url: string }) {
	await client().emails.send({
		from: env.EMAIL_FROM!,
		to: opts.to,
		subject: 'Velg nytt passord',
		html: `
			<p>Hei,</p>
			<p>Vi har fått en forespørsel om å endre passordet ditt. Klikk lenken nedenfor for å velge et nytt:</p>
			<p><a href="${opts.url}">Velg nytt passord</a></p>
			<p>Lenken utløper etter én time. Har du ikke bedt om dette, kan du se bort fra e-posten.</p>
		`
	});
}
