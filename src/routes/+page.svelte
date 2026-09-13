<script lang="ts">
	import { authClient } from '$lib/auth-client';

	const session = authClient.useSession();
</script>

<div class="min-h-screen bg-gray-50 flex items-center justify-center">
	{#if $session.isPending}
		<p class="text-gray-500">Loading…</p>
	{:else if $session.data}
		<div class="text-center flex flex-col gap-3">
			<p class="text-gray-700">Signed in as {$session.data.user.email}</p>
			<a href="/flats" class="text-sm text-blue-600 hover:underline">Go to app</a>
			<button
				onclick={() => authClient.signOut()}
				class="text-sm text-gray-500 hover:text-gray-900 cursor-pointer"
			>
				Sign out
			</button>
		</div>
	{:else}
		<a href="/login" class="text-sm text-blue-600 hover:underline">Sign in</a>
	{/if}
</div>
