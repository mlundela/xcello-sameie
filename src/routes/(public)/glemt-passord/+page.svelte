<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let email = $state('');
	let loading = $state(false);
	let sent = $state(false);
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		// better-auth answers the same whether or not the address has an account
		const result = await authClient.requestPasswordReset({ email, redirectTo: '/nytt-passord' });
		loading = false;
		if (result.error) error = result.error.message ?? 'Kunne ikke sende lenken';
		else sent = true;
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body">
			<h1 class="card-title text-2xl mb-2">Glemt passord</h1>

			{#if sent}
				<p class="text-base-content/70">
					Hvis det finnes en konto for <strong>{email}</strong>, har vi sendt en lenke for å velge nytt passord.
					Lenken utløper etter én time.
				</p>
			{:else}
				<p class="text-sm text-base-content/70 mb-2">Skriv inn e-postadressen din, så sender vi en lenke for å velge nytt passord.</p>
				<form onsubmit={submit} class="flex flex-col gap-3">
					<label class="floating-label">
						<input
							type="email"
							bind:value={email}
							required
							autocomplete="email"
							placeholder="du@eksempel.no"
							class="input input-bordered w-full"
						/>
						<span>E-post</span>
					</label>

					{#if error}
						<div role="alert" class="alert alert-error alert-soft">
							<span>{error}</span>
						</div>
					{/if}

					<button type="submit" disabled={loading} class="btn btn-primary w-full">
						{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
						Send lenke
					</button>
				</form>
			{/if}

			<div class="divider text-base-content/40"></div>
			<p class="text-center text-sm"><a href="/login" class="link link-primary">Tilbake til innlogging</a></p>
		</div>
	</div>
</div>
