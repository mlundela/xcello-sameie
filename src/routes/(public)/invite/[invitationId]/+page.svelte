<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { roleLabel } from '$lib/roles';
	import { authClient } from '$lib/auth-client';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get_invitation, accept_invitation } from './invite.remote';

	const inv = $derived(get_invitation({ id: page.params.invitationId! }));
	// Login and signup send the user back here afterwards
	const back = $derived(encodeURIComponent(page.url.pathname));

	let accepting = $state(false);
	let acceptError = $state('');

	async function handleAccept() {
		accepting = true;
		acceptError = '';
		try {
			await accept_invitation({ invitationId: page.params.invitationId! });
			goto('/dashboard');
		} catch (err) {
			acceptError = errorMessage(err, 'Kunne ikke godta invitasjonen');
		} finally {
			accepting = false;
		}
	}

	async function switchAccount() {
		await authClient.signOut();
		goto(`/login?next=${back}`);
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body gap-4">
			{#await inv}
				<div class="flex justify-center py-12">
					<span class="loading loading-spinner loading-lg text-primary"></span>
				</div>
			{:then { expired, status, invitation, signedInEmail }}
				{#if expired}
					<h1 class="text-2xl font-bold">Invitasjonen er ikke lenger gyldig</h1>
					<p class="text-sm text-base-content/70">
						Invitasjonen er {status === 'accepted'
							? 'allerede godtatt'
							: status === 'canceled' || status === 'cancelled'
								? 'trukket tilbake'
								: 'utløpt'}.
					</p>
					<div class="card-actions">
						<a href="/" class="btn btn-ghost btn-sm">Til forsiden</a>
					</div>
				{:else if invitation}
					<h1 class="text-2xl font-bold">Du er invitert</h1>
					<p class="text-sm text-base-content/70">
						Bli med i <strong>{invitation.organizationName}</strong> som
						<strong>{roleLabel(invitation.role).toLowerCase()}</strong>.
					</p>

					{#if !signedInEmail}
						<p class="text-sm text-base-content/70">
							Invitasjonen er sendt til <strong>{invitation.email}</strong>. Logg inn eller opprett en konto med
							den adressen for å godta den.
						</p>
						<div class="card-actions flex-col">
							<a href="/login?next={back}" class="btn btn-primary w-full">Logg inn</a>
							<a href="/signup?next={back}&email={encodeURIComponent(invitation.email)}" class="btn btn-ghost w-full">
								Opprett konto
							</a>
						</div>
					{:else if signedInEmail.toLowerCase() !== invitation.email.toLowerCase()}
						<div role="alert" class="alert alert-warning alert-soft">
							<span>
								Du er logget inn som <strong>{signedInEmail}</strong>, men invitasjonen er sendt til
								<strong>{invitation.email}</strong>.
							</span>
						</div>
						<div class="card-actions">
							<button onclick={switchAccount} class="btn btn-ghost w-full">Logg inn med en annen konto</button>
						</div>
					{:else}
						{#if acceptError}
							<div role="alert" class="alert alert-error alert-soft">
								<span>{acceptError}</span>
							</div>
						{/if}
						<div class="card-actions">
							<button onclick={handleAccept} disabled={accepting} class="btn btn-primary w-full">
								{#if accepting}
									<span class="loading loading-spinner loading-sm"></span>
								{/if}
								Godta invitasjonen
							</button>
						</div>
					{/if}
				{/if}
			{:catch err}
				<div role="alert" class="alert alert-error">
					<span>{errorMessage(err)}</span>
				</div>
			{/await}
		</div>
	</div>
</div>
