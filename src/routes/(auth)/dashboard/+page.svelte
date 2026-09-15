<script lang="ts">
	import { formatKr } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/PageHeader.svelte';
	import { get_dashboard_data } from './dashboard.remote';

	const yearParam = $derived(page.url.searchParams.get('year'));
	const data = $derived(get_dashboard_data({ year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined }));

	const kr = (ore: number) => formatKr(ore, { decimals: false });
</script>

<main class="max-w-4xl px-4 sm:px-6 py-8 flex flex-col gap-6">
	<PageHeader title="Regnskapsperiode">
		{#await data then { periods, period }}
			{#if period}
				<select
					class="select select-bordered select-sm w-auto"
					aria-label="Regnskapsår"
					value={period.year}
					onchange={(e) => goto(`/dashboard?year=${e.currentTarget.value}`)}
				>
					{#each periods as p (p.year)}
						<option value={p.year}>{p.year}</option>
					{/each}
				</select>
				{#if period.status === 'OPEN'}
					<span class="badge badge-sm badge-success badge-soft">Åpen</span>
				{:else}
					<span class="badge badge-sm badge-ghost">Lukket</span>
				{/if}
			{/if}
		{/await}
	</PageHeader>

	{#await data}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then { period, rows }}
		{#if !period}
			<div role="alert" class="alert">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info h-6 w-6 shrink-0">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
				<span>
					Sameiet har ikke noe regnskapsår ennå.
					{#if page.data.canEdit}<a href="/organizations/new" class="link">Fullfør oppsettet</a> med første regnskapsår og inngående saldo.{:else}Be en administrator fullføre oppsettet.{/if}
				</span>
			</div>
		{:else if rows.length === 0}
			<div class="card bg-base-100">
				<div class="card-body items-center gap-4">
					<p class="text-base-content/60">Ingen aktive eiere i denne perioden.</p>
				</div>
			</div>
		{:else}
			<div class="card bg-base-100">
				<div class="card-body py-2">
					<div class="overflow-x-auto">
					<table class="table">
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
									<td class="whitespace-nowrap">
										<span class="font-medium">{row.ownerName}</span>
										<span class="ml-1 text-base-content/70">
											{#if row.flatNos.length === 0}
												tidligere eier
											{:else}
												{#each row.flatNos as flatNo, i}
													<a href="/flats/{flatNo}" class="link link-hover">{flatNo}</a>{#if i < row.flatNos.length - 1} | {/if}
												{/each}
											{/if}
										</span>
									</td>
									<td class="text-right tabular-nums text-base-content/70">{kr(row.openingOre)}</td>
									<td class="text-right tabular-nums text-base-content/70">{kr(row.expectedOre)}</td>
									<td class="text-right tabular-nums">{kr(row.paidOre)}</td>
									<td
										class="text-right tabular-nums"
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
			</div>
			<p class="text-sm text-base-content/70">
				Saldo = inngående saldo + innbetalt − forventede felleskostnader hittil i året. Negativ saldo betyr at eieren skylder.
			</p>
		{/if}
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
