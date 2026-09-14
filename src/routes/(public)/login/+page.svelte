<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { safeNext } from '$lib/next';

	// Signed-in users never get here: +page.server.ts redirects them before render
	const next = $derived(safeNext(page.url.searchParams.get('next')));

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function signInWithEmail(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		const result = await authClient.signIn.email({ email, password, callbackURL: next });
		loading = false;
		if (result.error) error = result.error.message ?? 'Innlogging feilet';
		else await goto(next, { invalidateAll: true });
	}

	function signInWithGoogle() {
		authClient.signIn.social({ provider: 'google', callbackURL: next });
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body">
			<h1 class="card-title text-2xl mb-2">Velkommen tilbake</h1>

			{#if page.url.searchParams.has('reset')}
				<div role="alert" class="alert alert-success alert-soft">
					<span>Passordet er endret. Logg inn med det nye passordet.</span>
				</div>
			{/if}

			<form onsubmit={signInWithEmail} class="flex flex-col gap-3">
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
						autocomplete="current-password"
						placeholder="••••••••"
						class="input input-bordered w-full"
					/>
					<span>Passord</span>
				</label>
				<a href="/glemt-passord" class="link link-hover text-sm self-end">Glemt passord?</a>

				{#if error}
					<div role="alert" class="alert alert-error alert-soft">
						<span>{error}</span>
					</div>
				{/if}

				<button type="submit" disabled={loading} class="btn btn-primary w-full mt-1">
					{#if loading}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Logg inn
				</button>
			</form>

			<div class="divider text-base-content/40">eller</div>

			<button onclick={signInWithGoogle} class="btn btn-outline w-full">
				Logg inn med Google
			</button>

			<div class="divider text-base-content/40"></div>

			<p class="text-center text-sm text-base-content/60">
				Ingen konto? <a href="/signup?next={encodeURIComponent(next)}" class="link link-primary">Registrer deg</a>
			</p>
		</div>
	</div>
</div>
