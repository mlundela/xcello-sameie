<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';

	// better-auth's reset link redirects here with ?token=… or ?error=INVALID_TOKEN
	const token = $derived(page.url.searchParams.get('token'));
	const linkInvalid = $derived(!token || page.url.searchParams.get('error') === 'INVALID_TOKEN');

	let password = $state('');
	let repeat = $state('');
	let loading = $state(false);
	let error = $state('');

	const messages: Record<string, string> = {
		INVALID_TOKEN: 'Lenken er ugyldig eller utløpt. Be om en ny lenke.',
		PASSWORD_TOO_SHORT: 'Passordet er for kort. Bruk minst 8 tegn.',
		PASSWORD_TOO_LONG: 'Passordet er for langt.'
	};

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (password !== repeat) {
			error = 'Passordene er ikke like.';
			return;
		}
		loading = true;
		const result = await authClient.resetPassword({ newPassword: password, token: token! });
		loading = false;
		if (result.error) error = messages[result.error.code ?? ''] ?? result.error.message ?? 'Kunne ikke endre passordet.';
		else goto('/login?reset=1');
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body">
			<h1 class="card-title text-2xl mb-2">Nytt passord</h1>

			{#if linkInvalid}
				<p class="text-base-content/70">Lenken er ugyldig eller utløpt.</p>
				<a href="/glemt-passord" class="btn btn-primary w-full mt-2">Be om en ny lenke</a>
			{:else}
				<form onsubmit={submit} class="flex flex-col gap-3">
					<label class="floating-label">
						<input
							type="password"
							bind:value={password}
							required
							minlength="8"
							autocomplete="new-password"
							placeholder="••••••••"
							class="input input-bordered w-full"
						/>
						<span>Nytt passord</span>
					</label>
					<label class="floating-label">
						<input
							type="password"
							bind:value={repeat}
							required
							minlength="8"
							autocomplete="new-password"
							placeholder="••••••••"
							class="input input-bordered w-full"
						/>
						<span>Gjenta passord</span>
					</label>

					{#if error}
						<div role="alert" class="alert alert-error alert-soft">
							<span>{error}</span>
						</div>
					{/if}

					<button type="submit" disabled={loading} class="btn btn-primary w-full">
						{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
						Lagre nytt passord
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>
