<script lang="ts">
	import '../app.css';
	import { showError, toasts } from '$lib/notify.svelte';
	let { children } = $props();
</script>

<!-- Commands fired from event handlers without a catch end up here instead of failing silently -->
<svelte:window onunhandledrejection={(e) => showError(e.reason)} />

{@render children()}

{#if toasts.length > 0}
	<div class="toast toast-end z-50">
		{#each toasts as t (t.id)}
			<div role="alert" class="alert alert-error"><span>{t.message}</span></div>
		{/each}
	</div>
{/if}
