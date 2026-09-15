<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body items-center text-center gap-4">
			<h1 class="text-2xl font-bold">{page.status}</h1>
			<p class="text-base-content/70">{page.error?.message}</p>
			<div class="card-actions">
				<a href="/dashboard" class="btn btn-primary btn-sm">Til forsiden</a>
			</div>
		</div>
	</div>
</div>
