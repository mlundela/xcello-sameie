import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';

if (!building && !env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

// Created on first use: the Resend constructor throws without a key, which breaks the build
let resend: Resend | undefined;
const client = () => (resend ??= new Resend(env.RESEND_API_KEY));

export async function sendVerificationEmail(opts: { to: string; url: string }) {
	await client().emails.send({
		from: 'onboarding@resend.dev',
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
		from: 'onboarding@resend.dev',
		to: opts.to,
		subject: `You've been invited to ${opts.organizationName}`,
		html: `
			<p>Hi,</p>
			<p><strong>${opts.inviterName}</strong> has invited you to join
			<strong>${opts.organizationName}</strong> as a <em>${opts.role}</em>.</p>
			<p><a href="${opts.acceptUrl}">Accept invitation</a></p>
			<p>This link expires in 48 hours.</p>
		`
	});
}
