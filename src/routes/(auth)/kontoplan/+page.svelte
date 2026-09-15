<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import { REQUIRED_ACCOUNT_CODES } from '$lib/accounts';
	import PageHeader from '$lib/PageHeader.svelte';
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

<main class="max-w-4xl px-4 sm:px-6 py-8 flex flex-col gap-6">
	<PageHeader crumbs={[]} title="Kontoplan">
		{#await accounts then rows}
			{#if page.data.canEdit && rows.length > 0}
				<button class="btn btn-ghost btn-sm ml-auto" onclick={seed} disabled={seeding}>
					{#if seeding}<span class="loading loading-spinner loading-sm"></span>{/if}
					Last inn standard kontoer
				</button>
			{/if}
		{/await}
	</PageHeader>

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
		{/if}

		{#each [['INCOME', 'Inntektskontoer'], ['EXPENSE', 'Utgiftskontoer'], ['LIABILITY', 'Gjeldskontoer'], ['ASSET', 'Eiendelskontoer'], ['EQUITY', 'Egenkapitalkontoer']] as [type, label]}
			{@const filtered = rows.filter((r) => r.type === type)}
			{#if filtered.length > 0}
				<div class="card bg-base-100">
					<div class="card-body gap-4">
						<h2 class="card-title">{label}</h2>
						<div class="overflow-x-auto">
						<table class="table">
							<thead>
								<tr>
									<th class="w-24">Konto</th>
									<th>Navn</th>
									<th class="w-px"></th>
								</tr>
							</thead>
							<tbody>
								{#each filtered as account}
									<tr>
										<td class="font-mono">{account.code}</td>
										<td>{account.name}</td>
										<td class="text-right py-0">
											{#if page.data.canEdit && !REQUIRED_ACCOUNT_CODES.includes(account.code)}
												<button
													class="btn btn-ghost btn-sm text-error"
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
				</div>
			{/if}
		{/each}

		{#if page.data.canEdit}
		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title">Legg til konto</h2>
				<div class="flex flex-wrap items-end gap-x-3 gap-y-4">
					<label class="flex flex-col gap-1 w-24">
						<span class="text-sm font-medium">Kode</span>
						<input class="input input-bordered w-full font-mono" bind:value={newCode} />
					</label>
					<label class="flex flex-col gap-1 flex-1 min-w-40">
						<span class="text-sm font-medium">Navn</span>
						<input class="input input-bordered w-full" bind:value={newName} />
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-sm font-medium">Type</span>
						<select class="select select-bordered w-auto" bind:value={newType}>
							<option value="INCOME">Inntekt</option>
							<option value="EXPENSE">Utgift</option>
							<option value="LIABILITY">Gjeld</option>
							<option value="ASSET">Eiendel</option>
							<option value="EQUITY">Egenkapital</option>
						</select>
					</label>
					<button
						class="btn btn-primary"
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
