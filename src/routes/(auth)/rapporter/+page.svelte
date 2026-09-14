<script lang="ts">
	import { krToOre } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import {
		get_rapport_years,
		get_opening_balance,
		set_opening_balance,
		get_owner_opening_balances,
		set_owner_opening_balance,
		open_next_year,
		carry_forward_opening_balance
	} from './rapporter.remote';

	const years = get_rapport_years();

	function oreToKr(ore: number): string {
		return (ore / 100).toFixed(2).replace('.', ',');
	}
</script>

<main class="max-w-2xl px-6 py-8 flex flex-col gap-6">
	<h1 class="text-2xl font-bold">Rapporter</h1>

	{#await years}
		<span class="loading loading-spinner"></span>
	{:then list}
		{@const nextYear = (list[0] ?? 0) + 1}
		{#if page.data.canEdit && list.length > 0 && nextYear <= new Date().getFullYear() + 1}
			<div class="flex items-center gap-3 flex-wrap">
				<button class="btn btn-primary btn-sm" onclick={() => open_next_year({}).updates(years)}>
					Start regnskapsår {nextYear}
				</button>
				<span class="text-xs text-base-content/50">Inngående saldo hentes fra utgående saldo {nextYear - 1}.</span>
			</div>
		{/if}
		{#if list.length === 0}
			<p class="text-base-content/50">Ingen regnskapsperioder registrert ennå.</p>
		{:else}
			<div class="flex flex-col gap-8">
				{#each list as year}
					{@const obQuery = get_opening_balance({ year })}
					{@const ownerBalQuery = get_owner_opening_balances({ year })}
					<div class="card bg-base-100">
						<div class="card-body gap-4">
							<h2 class="card-title">{year}</h2>

							<div class="flex gap-2 flex-wrap">
								<a
									href="/rapporter/{year}"
									target="_blank"
									class="btn btn-outline btn-sm gap-2"
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
									</svg>
									Resultatregnskap
								</a>

								{#await obQuery then ob}
									<a
										href="/rapporter/{year}/balanse"
										target="_blank"
										class="btn btn-outline btn-sm gap-2"
										class:btn-disabled={!ob}
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
										</svg>
										Balanserapport
									</a>
								{/await}
							</div>

							<div class="divider my-0"></div>

							<div class="flex items-center justify-between gap-2">
								<p class="text-xs font-medium text-base-content/60 uppercase tracking-wide">Inngående saldo 1. jan {year}</p>
								{#if page.data.canEdit && list.includes(year - 1)}
									<button
										class="btn btn-ghost btn-xs"
										onclick={() => {
											if (confirm(`Erstatte inngående saldo for ${year} med utgående saldo fra ${year - 1}?`))
												carry_forward_opening_balance({ year }).updates(obQuery, ownerBalQuery);
										}}
									>Hent fra {year - 1}</button>
								{/if}
							</div>

							{#await obQuery then ob}
								{@const bankVal = ob ? oreToKr(ob.bankOre) : ''}
								{@const loanVal = ob ? oreToKr(ob.loanOre) : ''}
								<form
									class="grid grid-cols-2 gap-3"
									onsubmit={(e) => {
										e.preventDefault();
										const fd = new FormData(e.currentTarget);
										set_opening_balance({
											year,
											bankOre: krToOre(fd.get('bank') as string),
											loanOre: krToOre(fd.get('loan') as string)
										}).updates(obQuery);
									}}
								>
									<label class="flex flex-col gap-1">
										<span class="text-xs text-base-content/60">1920 Bankkonto (kr)</span>
										<input
											name="bank"
											disabled={!page.data.canEdit}
											type="text"
											inputmode="decimal"
											class="input input-bordered input-sm"
											value={bankVal}
											placeholder="0,00"
										/>
									</label>
									<label class="flex flex-col gap-1">
										<span class="text-xs text-base-content/60">2400 Langsiktig gjeld (kr)</span>
										<input
											name="loan"
											disabled={!page.data.canEdit}
											type="text"
											inputmode="decimal"
											class="input input-bordered input-sm"
											value={loanVal}
											placeholder="0,00"
										/>
									</label>
									{#if page.data.canEdit}
										<div class="col-span-2">
											<button type="submit" class="btn btn-primary btn-sm">Lagre</button>
										</div>
									{/if}
								</form>
							{/await}

							{#await ownerBalQuery then owners}
								{#if owners.length > 0}
									<p class="text-xs font-medium text-base-content/60 uppercase tracking-wide mt-2">Eierbalanse 1. jan {year}</p>
									<p class="text-xs text-base-content/50">Positiv = eier har til gode (forhåndsbetalt). Negativ = eier skylder (fordring).</p>
									<div class="flex flex-col gap-2">
										{#each owners as o}
											<div class="flex items-center gap-3">
												<div class="flex-1 min-w-0">
													<p class="text-sm truncate">{o.ownerName}</p>
													<p class="text-xs text-base-content/50">{o.flatNos.join(', ')}</p>
												</div>
												<input
													type="text"
													inputmode="decimal"
													class="input input-bordered input-xs w-28 text-right font-mono"
													disabled={!page.data.canEdit}
													value={oreToKr(o.balanceOre)}
													aria-label="Inngående saldo for {o.ownerName}"
													placeholder="0,00"
													onchange={(e) => {
														const val = krToOre((e.currentTarget as HTMLInputElement).value);
														set_owner_opening_balance({ year, ownerId: o.ownerId, balanceOre: val })
															.updates(ownerBalQuery);
													}}
												/>
												<span class="text-xs text-base-content/50 w-4">kr</span>
											</div>
										{/each}
									</div>
								{/if}
							{/await}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
