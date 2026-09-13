<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import { get_accounts, create_account, delete_account, seed_default_accounts } from './kontoplan.remote';

	const accounts = get_accounts();

	let newCode = $state('');
	let newName = $state('');
	let newType = $state<'INCOME' | 'EXPENSE' | 'LIABILITY' | 'ASSET' | 'EQUITY'>('EXPENSE');
	let creating = $state(false);
	let seeding = $state(false);

	async function create() {
		creating = true;
		try {
			await create_account({ code: newCode, name: newName, type: newType });
			newCode = '';
			newName = '';
		} finally {
			creating = false;
		}
	}

	async function seed() {
		seeding = true;
		try {
			await seed_default_accounts({});
		} finally {
			seeding = false;
		}
	}
</script>

<main class="max-w-4xl px-6 py-8 flex flex-col gap-6">
	<div class="breadcrumbs text-sm">
		<ul>
			<li>Kontoplan</li>
		</ul>
	</div>

	{#await accounts}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then rows}
		{#if rows.length === 0}
			<div class="card bg-base-100">
				<div class="card-body items-center gap-4">
					<p class="text-base-content/60">Ingen kontoer er satt opp ennå.</p>
					{#if page.data.canEdit}
						<button class="btn btn-primary" onclick={seed} disabled={seeding}>
							{#if seeding}<span class="loading loading-spinner loading-sm"></span>{/if}
							Last inn standard kontoer (NS 4102)
						</button>
					{/if}
				</div>
			</div>
		{:else if page.data.canEdit}
			<div class="flex justify-end">
				<button class="btn btn-ghost btn-sm" onclick={seed} disabled={seeding}>
					{#if seeding}<span class="loading loading-spinner loading-sm"></span>{/if}
					Last inn standard kontoer
				</button>
			</div>
		{/if}

		{#each [['INCOME', 'Inntektskontoer'], ['EXPENSE', 'Utgiftskontoer'], ['LIABILITY', 'Gjeldskontoer'], ['ASSET', 'Eiendelskontoer'], ['EQUITY', 'Egenkapitalkontoer']] as [type, label]}
			{@const filtered = rows.filter((r) => r.type === type)}
			{#if filtered.length > 0}
				<div class="card bg-base-100">
					<div class="card-body gap-3">
						<h2 class="card-title text-base">{label}</h2>
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Konto</th>
									<th>Navn</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each filtered as account}
									<tr>
										<td class="font-mono">{account.code}</td>
										<td>{account.name}</td>
										<td class="text-right">
											{#if page.data.canEdit}
												<button
													class="btn btn-ghost btn-xs text-error"
													onclick={() => delete_account({ id: account.id })}
												>Slett</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		{/each}

		{#if page.data.canEdit}
		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title text-base">Legg til konto</h2>
				<div class="flex gap-2 flex-wrap">
					<input
						class="input input-bordered input-sm w-24"
						placeholder="Kode"
						bind:value={newCode}
					/>
					<input
						class="input input-bordered input-sm flex-1 min-w-40"
						placeholder="Navn"
						bind:value={newName}
					/>
					<select class="select select-bordered select-sm" bind:value={newType}>
						<option value="INCOME">Inntekt</option>
						<option value="EXPENSE">Utgift</option>
						<option value="LIABILITY">Gjeld</option>
						<option value="ASSET">Eiendel</option>
						<option value="EQUITY">Egenkapital</option>
					</select>
					<button
						class="btn btn-primary btn-sm"
						onclick={create}
						disabled={creating || !newCode || !newName}
					>
						{#if creating}<span class="loading loading-spinner loading-sm"></span>{/if}
						Legg til
					</button>
				</div>
			</div>
		</div>
		{/if}
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
