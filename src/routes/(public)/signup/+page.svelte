<script lang="ts">
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { safeNext } from '$lib/next';

	// Signed-in users never get here: +page.server.ts redirects them before render.
	// `next` survives email verification (e.g. back to an invitation); `email` is prefilled from the invite.
	const next = $derived(safeNext(page.url.searchParams.get('next')));

	let name = $state('');
	let email = $state(page.url.searchParams.get('email') ?? '');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let submitted = $state(false);

	async function signUp(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		const result = await authClient.signUp.email({
			name,
			email,
			password,
			callbackURL: next
		});
		if (result.error) error = result.error.message ?? 'Registrering feilet';
		else submitted = true;
		loading = false;
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	{#if submitted}
		<div class="card w-full max-w-sm bg-base-100 shadow-xl">
			<div class="card-body items-center text-center gap-4">
				<h1 class="text-2xl font-bold">Sjekk e-posten din</h1>
				<p class="text-base-content/70">Vi har sendt en bekreftelseslenke til <strong>{email}</strong>. Klikk lenken for å aktivere kontoen.</p>
			</div>
		</div>
	{:else}
		<div class="card w-full max-w-sm bg-base-100 shadow-xl">
			<div class="card-body gap-4">
				<h1 class="text-2xl font-bold">Opprett konto</h1>

				<form onsubmit={signUp} class="flex flex-col gap-4">
					<label class="floating-label">
						<input
							type="text"
							bind:value={name}
							required
							autocomplete="name"
							placeholder="Ola Nordmann"
							class="input input-bordered w-full"
						/>
						<span>Navn</span>
					</label>

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

					<label class="floating-label">
						<input
							type="password"
							bind:value={password}
							required
							autocomplete="new-password"
							placeholder="••••••••"
							class="input input-bordered w-full"
						/>
						<span>Passord</span>
					</label>

					{#if error}
						<div role="alert" class="alert alert-error alert-soft">
							<span>{error}</span>
						</div>
					{/if}

					<button type="submit" disabled={loading} class="btn btn-primary w-full">
						{#if loading}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Registrer deg
					</button>
				</form>

				<div class="divider my-0 text-base-content/60"></div>

				<p class="text-center text-sm text-base-content/60">
					Har du allerede konto? <a href="/login?next={encodeURIComponent(next)}" class="link link-primary">Logg inn</a>
				</p>
			</div>
		</div>
	{/if}
</div>
