<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { roleLabel } from '$lib/roles';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get_invitation, accept_invitation } from './invite.remote';

	const inv = $derived(get_invitation({ id: page.params.invitationId! }));

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
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body">
			{#await inv}
				<div class="flex justify-center py-4">
					<span class="loading loading-spinner loading-lg text-primary"></span>
				</div>
			{:then { expired, status, invitation }}
				{#if expired}
					<h1 class="card-title">Invitasjonen er ikke lenger gyldig</h1>
					<p class="text-sm text-base-content/60">
						Invitasjonen er {status === 'accepted'
							? 'allerede godtatt'
							: status === 'canceled' || status === 'cancelled'
								? 'trukket tilbake'
								: 'utløpt'}.
					</p>
					<div class="card-actions mt-2">
						<a href="/" class="btn btn-ghost btn-sm">Til forsiden</a>
					</div>
				{:else if invitation}
					<h1 class="card-title">Du er invitert</h1>
					<p class="text-sm text-base-content/70">
						Bli med i <strong>{invitation.organizationName}</strong> som
						<strong>{roleLabel(invitation.role).toLowerCase()}</strong>.
					</p>
					{#if acceptError}
						<div role="alert" class="alert alert-error alert-soft">
							<span>{acceptError}</span>
						</div>
					{/if}
					<div class="card-actions mt-2">
						<button onclick={handleAccept} disabled={accepting} class="btn btn-primary w-full">
							{#if accepting}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Godta invitasjonen
						</button>
					</div>
				{/if}
			{:catch err}
				<div role="alert" class="alert alert-error">
					<span>{errorMessage(err)}</span>
				</div>
			{/await}
		</div>
	</div>
</div>
