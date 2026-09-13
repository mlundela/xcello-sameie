<script lang="ts">
	import { authClient } from '$lib/auth-client';

	const session = authClient.useSession();

	let name = $state('');
	let email = $state('');
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
			callbackURL: '/dashboard'
		});
		if (result.error) error = result.error.message ?? 'Registrering feilet';
		else submitted = true;
		loading = false;
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	{#if $session.isPending}
		<span class="loading loading-spinner loading-lg text-primary"></span>
	{:else if submitted}
		<div class="card w-full max-w-sm bg-base-100 shadow-xl">
			<div class="card-body items-center text-center">
				<h1 class="card-title text-2xl mb-2">Sjekk e-posten din</h1>
				<p class="text-base-content/70">Vi har sendt en bekreftelseslenke til <strong>{email}</strong>. Klikk lenken for å aktivere kontoen.</p>
			</div>
		</div>
	{:else}
		<div class="card w-full max-w-sm bg-base-100 shadow-xl">
			<div class="card-body">
				<h1 class="card-title text-2xl mb-2">Opprett konto</h1>

				<form onsubmit={signUp} class="flex flex-col gap-3">
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

					<button type="submit" disabled={loading} class="btn btn-primary w-full mt-1">
						{#if loading}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Registrer deg
					</button>
				</form>

				<div class="divider text-base-content/40"></div>

				<p class="text-center text-sm text-base-content/60">
					Har du allerede konto? <a href="/login" class="link link-primary">Logg inn</a>
				</p>
			</div>
		</div>
	{/if}
</div>
