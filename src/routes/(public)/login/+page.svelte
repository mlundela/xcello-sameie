<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authClient } from '$lib/auth-client';

	const session = authClient.useSession();
	const next = $derived($page.url.searchParams.get('next') ?? '/dashboard');

	$effect(() => {
		if ($session.data) goto(next);
	});

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function signInWithEmail(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		const result = await authClient.signIn.email({ email, password, callbackURL: next });
		if (result.error) error = result.error.message ?? 'Sign in failed';
		loading = false;
	}

	function signInWithGoogle() {
		authClient.signIn.social({ provider: 'google', callbackURL: next });
	}
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	{#if $session.isPending}
		<span class="loading loading-spinner loading-lg text-primary"></span>
	{:else if !$session.data}
		<div class="card w-full max-w-sm bg-base-100 shadow-xl">
			<div class="card-body">
				<h1 class="card-title text-2xl mb-2">Welcome back</h1>

				<form onsubmit={signInWithEmail} class="flex flex-col gap-3">
					<label class="floating-label">
						<input
							type="email"
							bind:value={email}
							required
							autocomplete="email"
							placeholder="you@example.com"
							class="input input-bordered w-full"
						/>
						<span>Email</span>
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
						<span>Password</span>
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
						Sign in
					</button>
				</form>

				<div class="divider text-base-content/40">or</div>

				<button onclick={signInWithGoogle} class="btn btn-outline w-full">
					Sign in with Google
				</button>

				<div class="divider text-base-content/40"></div>

				<p class="text-center text-sm text-base-content/60">
					Ingen konto? <a href="/signup" class="link link-primary">Registrer deg</a>
				</p>
			</div>
		</div>
	{/if}
</div>
