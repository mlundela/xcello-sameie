<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import PageHeader from '$lib/PageHeader.svelte';
	import { get_rules, create_rule, delete_rule } from './matchingsregler.remote';
	import { get_accounts } from '../kontoplan/kontoplan.remote';

	const data = get_rules();
	const accountsData = get_accounts();

	let newPattern = $state('');
	// "owner:<id>" or "account:<id>", the same encoding as the categorisation selects
	let newTarget = $state('');
	let newUserDescription = $state('');
	let newReceiptNotRequired = $state(false);
	let creating = $state(false);

	async function create() {
		creating = true;
		try {
			const [kind, id] = newTarget.split(':');
			await create_rule({
				pattern: newPattern,
				ownerId: kind === 'owner' ? id : undefined,
				ledgerAccountId: kind === 'account' ? id : undefined,
				receiptNotRequired: newReceiptNotRequired,
				userDescription: newUserDescription || undefined
			});
			newPattern = '';
			newTarget = '';
			newUserDescription = '';
			newReceiptNotRequired = false;
		} finally {
			creating = false;
		}
	}
</script>

<main class="max-w-4xl px-4 sm:px-6 py-8 flex flex-col gap-6">
	<PageHeader crumbs={[]} title="Matchingsregler" />

	{#await Promise.all([data, accountsData])}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then [{ rules, owners }, accounts]}
		{@const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE')}
		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title">Regler</h2>
				<p class="text-base-content/70">
					Når en importert banktransaksjon inneholder mønsteret, kobles den til eieren eller kategoriseres
					på kontoen. Eierregler gjelder både innbetalinger og tilbakebetalinger, kontoregler bare utbetalinger.
					Passer flere regler, brukes den med lengst mønster.
				</p>
				{#if rules.length === 0}
					<p class="text-base-content/60">Ingen regler er definert ennå.</p>
				{:else}
					<div class="overflow-x-auto">
					<table class="table">
						<thead>
							<tr>
								<th>Mønster</th>
								<th>Kobles til</th>
								<th>Beskrivelse</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each rules as rule (rule.id)}
								<tr>
									<td class="font-mono">{rule.pattern}</td>
									<td>
										{#if rule.ownerName}
											{rule.ownerName}
										{:else}
											{rule.accountCode} {rule.accountName}
										{/if}
										{#if rule.receiptNotRequired}
											<span class="badge badge-ghost badge-sm ml-1">Uten kvittering</span>
										{/if}
									</td>
									<td class="text-base-content/70">{rule.userDescription ?? ''}</td>
									<td class="text-right py-0">
										{#if page.data.canEdit}
											<button
												class="btn btn-ghost btn-sm text-error"
												onclick={() => delete_rule({ id: rule.id })}
											>Slett</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					</div>
				{/if}
			</div>
		</div>

		{#if page.data.canEdit}
		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title">Ny regel</h2>
				<div class="grid gap-x-3 gap-y-4 sm:grid-cols-2">
					<label class="flex flex-col gap-1">
						<span class="text-sm font-medium">Mønster</span>
						<input class="input input-bordered w-full" placeholder="F.eks. «Ola Nordmann»" bind:value={newPattern} />
						<span class="text-xs text-base-content/60">Transaksjoner der beskrivelsen inneholder dette mønsteret kobles automatisk.</span>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-sm font-medium">Kobles til</span>
						<select class="select select-bordered w-full" bind:value={newTarget}>
							<option value="">Velg...</option>
							{#if owners.length > 0}
								<optgroup label="Eiere">
									{#each owners as o (o.id)}
										<option value="owner:{o.id}">{o.name}</option>
									{/each}
								</optgroup>
							{/if}
							{#if expenseAccounts.length > 0}
								<optgroup label="Utgifter">
									{#each expenseAccounts as a (a.id)}
										<option value="account:{a.id}">{a.code} {a.name}</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					</label>
					<label class="flex flex-col gap-1 sm:col-span-2">
						<span class="text-sm font-medium">Beskrivelse (valgfri)</span>
						<input class="input input-bordered w-full" placeholder="F.eks. «Strømregning»" bind:value={newUserDescription} />
						<span class="text-xs text-base-content/60">Overstyrer bankens beskrivelse på matchede transaksjoner.</span>
					</label>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3">
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" class="checkbox" bind:checked={newReceiptNotRequired} />
						<span>Krever ikke kvittering</span>
					</label>
					<button
						class="btn btn-primary"
						onclick={create}
						disabled={creating || !newPattern || !newTarget}
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
