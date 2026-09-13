<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { get_rules, create_rule, delete_rule } from './matchingsregler.remote';

	const data = get_rules();

	let newPattern = $state('');
	let newOwnerId = $state('');
	let creating = $state(false);

	async function create() {
		creating = true;
		try {
			await create_rule({ pattern: newPattern, ownerId: newOwnerId });
			newPattern = '';
			newOwnerId = '';
		} finally {
			creating = false;
		}
	}
</script>

<main class="max-w-4xl px-6 py-8 flex flex-col gap-6">
	<div class="breadcrumbs text-sm">
		<ul>
			<li><a href="/dashboard">Hjem</a></li>
			<li><a href="/inntekter">Inntekter</a></li>
			<li>Matchingsregler</li>
		</ul>
	</div>

	{#await data}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then { rules, owners }}
		<div class="card bg-base-100">
			<div class="card-body gap-3">
				<h2 class="card-title text-base">Regler</h2>
				<p class="text-sm text-base-content/60">
					Innbetalinger der beskrivelsen inneholder mønsteret knyttes automatisk til eieren.
				</p>
				{#if rules.length === 0}
					<p class="text-sm text-base-content/40 py-4 text-center">Ingen regler er definert ennå.</p>
				{:else}
					<table class="table table-sm">
						<thead>
							<tr>
								<th>Mønster</th>
								<th>Eier</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each rules as rule}
								<tr>
									<td class="font-mono">{rule.pattern}</td>
									<td>{rule.ownerName}</td>
									<td class="text-right">
										<button
											class="btn btn-ghost btn-xs text-error"
											onclick={() => delete_rule({ id: rule.id })}
										>Slett</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title text-base">Ny regel</h2>
				<div class="flex gap-2 flex-wrap">
					<input
						class="input input-bordered input-sm flex-1 min-w-40"
						placeholder="Mønster (f.eks. «Ola Nordmann»)"
						bind:value={newPattern}
					/>
					<select class="select select-bordered select-sm flex-1 min-w-40" bind:value={newOwnerId}>
						<option value="">Velg eier...</option>
						{#each owners as o}
							<option value={o.id}>{o.name}</option>
						{/each}
					</select>
					<button
						class="btn btn-primary btn-sm"
						onclick={create}
						disabled={creating || !newPattern || !newOwnerId}
					>
						{#if creating}<span class="loading loading-spinner loading-sm"></span>{/if}
						Legg til
					</button>
				</div>
			</div>
		</div>
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
