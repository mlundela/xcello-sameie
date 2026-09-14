<script lang="ts">
	import { formatKr } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get_dashboard_data } from './dashboard.remote';

	const yearParam = $derived(page.url.searchParams.get('year'));
	const data = $derived(get_dashboard_data({ year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined }));

	const kr = (ore: number) => formatKr(ore, { decimals: false });
</script>

<main class="max-w-4xl px-6 py-8 flex flex-col gap-6">
	<div class="breadcrumbs text-sm">
		<ul>
			<li>Dashboard</li>
		</ul>
	</div>

	{#await data}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then { periods, period, rows }}
		{#if !period}
			<div role="alert" class="alert">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info h-6 w-6 shrink-0">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
				<span>Ingen åpen regnskapsperiode. Start et regnskapsår under <a href="/rapporter" class="link">Rapporter</a> for å se betalingsstatus.</span>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-3 flex-wrap">
					<h1 class="text-xl font-bold">Regnskapsperiode</h1>
					<select
						class="select select-bordered select-sm"
						aria-label="Regnskapsår"
						value={period.year}
						onchange={(e) => goto(`/dashboard?year=${e.currentTarget.value}`)}
					>
						{#each periods as p (p.year)}
							<option value={p.year}>{p.year}</option>
						{/each}
					</select>
					{#if period.status === 'OPEN'}
						<span class="badge badge-success badge-soft">Åpen</span>
					{:else}
						<span class="badge badge-ghost">Lukket</span>
					{/if}
				</div>
				<p class="text-xs text-base-content/50">
					Saldo = inngående saldo + innbetalt − forventede felleskostnader hittil i året. Negativ saldo betyr at eieren skylder.
				</p>
			</div>

			{#if rows.length === 0}
				<div class="card bg-base-100">
					<div class="card-body items-center">
						<p class="text-base-content/60">Ingen aktive eiere i denne perioden.</p>
					</div>
				</div>
			{:else}
				<div class="card bg-base-100">
					<div class="card-body p-0 overflow-x-auto">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Eier</th>
									<th class="text-right">Inngående</th>
									<th class="text-right">Forventet</th>
									<th class="text-right">Innbetalt</th>
									<th class="text-right">Saldo</th>
								</tr>
							</thead>
							<tbody>
								{#each rows as row (row.ownerId)}
									<tr>
										<td>
											<p class="font-medium">
												{row.ownerName}
												<span class="text-xs text-base-content/50">
													{#if row.flatNos.length === 0}
														tidligere eier
													{:else}
														{#each row.flatNos as flatNo, i}
															<a href="/flats/{flatNo}" class="link link-hover">{flatNo}</a>{#if i < row.flatNos.length - 1} | {/if}
														{/each}
													{/if}
												</span>
											</p>
										</td>
										<td class="text-right font-mono text-base-content/70">{kr(row.openingOre)}</td>
										<td class="text-right font-mono text-base-content/70">{kr(row.expectedOre)}</td>
										<td class="text-right font-mono">{kr(row.paidOre)}</td>
										<td
											class="text-right font-mono"
											class:text-success={row.balanceOre >= 0}
											class:text-error={row.balanceOre < 0}
										>
											{row.balanceOre >= 0 ? '+' : ''}{kr(row.balanceOre)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		{/if}
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
