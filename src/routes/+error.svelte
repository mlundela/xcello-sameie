<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="min-h-screen bg-base-200 flex items-center justify-center px-4">
	<div class="card w-full max-w-sm bg-base-100 shadow-xl">
		<div class="card-body items-center text-center">
			<h1 class="card-title text-2xl">{page.status}</h1>
			<p class="text-base-content/70">{page.error?.message}</p>
			<div class="card-actions mt-2">
				<a href="/dashboard" class="btn btn-primary btn-sm">Til forsiden</a>
			</div>
		</div>
	</div>
</div>
