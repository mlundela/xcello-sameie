<script lang="ts">
	import { formatKr } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { get_dashboard_data } from './dashboard.remote';

	const data = get_dashboard_data();
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
	{:then { period, rows }}
		{#if !period}
			<div role="alert" class="alert">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info h-6 w-6 shrink-0">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
				<span>Ingen åpen regnskapsperiode. Opprett en regnskapsperiode for å se betalingsstatus.</span>
			</div>
		{:else}
			<div class="flex items-center gap-3">
				<h1 class="text-xl font-bold">Regnskapsperiode {period.year}</h1>
				<span class="badge badge-success badge-soft">Åpen</span>
			</div>

			{#if rows.length === 0}
				<div class="card bg-base-100">
					<div class="card-body items-center">
						<p class="text-base-content/60">Ingen aktive eiere i denne perioden.</p>
					</div>
				</div>
			{:else}
				<div class="card bg-base-100">
					<div class="card-body p-0">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Eier</th>
									<th class="text-right">Forventet</th>
									<th class="text-right">Innbetalt</th>
									<th class="text-right">Balanse</th>
									</tr>
							</thead>
							<tbody>
								{#each rows as row}
									<tr>
										<td>
											<p class="font-medium">{row.ownerName}
											<span class="text-xs text-base-content/50">
												{#each row.flatNos as flatNo, i}
													<a href="/flats/{flatNo}" class="link link-hover">{flatNo}</a>{#if i < row.flatNos.length - 1} | {/if}
												{/each}
											</span>
											</p>
										</td>
										<td class="text-right font-mono text-base-content/70">{formatKr(row.expectedOre, { decimals: false })}</td>
										<td class="text-right font-mono">{formatKr(row.actualOre, { decimals: false })}</td>
										<td
											class="text-right font-mono"
											class:text-success={row.balanceOre >= 0}
											class:text-error={row.balanceOre < 0}
										>
											{row.balanceOre >= 0 ? '+' : ''}{formatKr(row.balanceOre, { decimals: false })}
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
