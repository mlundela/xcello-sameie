<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
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

<main class="max-w-4xl px-6 py-8 flex flex-col gap-6">
	<div class="breadcrumbs text-sm">
		<ul>
			<li><a href="/dashboard">Hjem</a></li>
			<li>Matchingsregler</li>
		</ul>
	</div>

	{#await Promise.all([data, accountsData])}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then [{ rules, owners }, accounts]}
		{@const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE')}
		<div class="card bg-base-100">
			<div class="card-body gap-3">
				<h2 class="card-title text-base">Regler</h2>
				<p class="text-sm text-base-content/60">
					Når en importert banktransaksjon inneholder mønsteret, kobles den til eieren eller kategoriseres
					på kontoen. Eierregler gjelder både innbetalinger og tilbakebetalinger, kontoregler bare utbetalinger.
				</p>
				{#if rules.length === 0}
					<p class="text-sm text-base-content/40 py-4 text-center">Ingen regler er definert ennå.</p>
				{:else}
					<table class="table table-sm">
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
											<span class="badge badge-ghost badge-xs ml-1">Uten kvittering</span>
										{/if}
									</td>
									<td class="text-base-content/70">{rule.userDescription ?? ''}</td>
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
					<select class="select select-bordered select-sm flex-1 min-w-40" bind:value={newTarget}>
						<option value="">Kobles til...</option>
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
				</div>
				<div class="flex gap-4 flex-wrap items-center">
					<input
						class="input input-bordered input-sm flex-1 min-w-40"
						placeholder="Beskrivelse (valgfri, f.eks. «Strømregning»)"
						bind:value={newUserDescription}
					/>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={newReceiptNotRequired} />
						<span class="text-sm">Krever ikke kvittering</span>
					</label>
					<button
						class="btn btn-primary btn-sm"
						onclick={create}
						disabled={creating || !newPattern || !newTarget}
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
