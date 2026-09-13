<script lang="ts">
	import { errorMessage } from '$lib/notify.svelte';
	import { goto } from '$app/navigation';
	import { get_husleie, set_bulk_rent } from './husleie.remote';

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

	const data = get_husleie();

	let step = $state<1 | 2>(1);
	let fromYear = $state(new Date().getFullYear());
	let fromMonth = $state(new Date().getMonth() + 1);
	let autoFill = $state(true);
	let amounts = $state<Record<string, string>>({});
	let saving = $state(false);
	let error = $state('');
	let success = $state(false);

	function fillFromShare(flats: Awaited<typeof data>, changedFlatId: string) {
		if (!autoFill) return;
		const first = flats.find((f) => f.id === changedFlatId);
		if (!first) return;
		const firstAmount = Number(amounts[changedFlatId]);
		if (!firstAmount || firstAmount <= 0) return;
		const unitRate = firstAmount / (first.shareNumerator / first.shareDenominator);
		for (const f of flats) {
			if (f.id === changedFlatId) continue;
			if (amounts[f.id]) continue;
			amounts[f.id] = String(Math.round(unitRate * (f.shareNumerator / f.shareDenominator)));
		}
	}

	async function handleSubmit(flats: Awaited<typeof data>) {
		error = '';
		success = false;
		const rents = flats.map((f) => ({
			flatId: f.id,
			amountKr: Math.round(Number(amounts[f.id] ?? 0))
		}));
		if (rents.some((r) => !r.amountKr || r.amountKr <= 0)) {
			error = 'Fyll inn gyldig beløp for alle leiligheter';
			return;
		}
		saving = true;
		try {
			await set_bulk_rent({ fromYear, fromMonth, rents });
			goto('/flats');
		} catch (err) {
			error = errorMessage(err, 'Feil ved lagring');
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex items-start justify-center pt-16 px-4">
	<div class="w-full max-w-lg">

		<ul class="steps w-full mb-6">
			<li class="step" class:step-primary={step >= 1}>Gjelder fra</li>
			<li class="step" class:step-primary={step >= 2}>Nye satser</li>
		</ul>

		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">

				{#if step === 1}
					<h1 class="card-title text-xl mb-2">Velg startdato</h1>
					<p class="text-sm text-base-content/60 mb-4">
						Fra hvilken måned skal de nye satsene gjelde?
					</p>
					<div class="flex gap-3 mb-6">
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium">Måned</span>
							<select bind:value={fromMonth} class="select select-bordered">
								{#each MONTHS as m, i}
									<option value={i + 1}>{m}</option>
								{/each}
							</select>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium">År</span>
							<input
								type="number"
								bind:value={fromYear}
								min="2000"
								max="2100"
								class="input input-bordered w-28 tabular-nums"
							/>
						</label>
					</div>
					<button onclick={() => (step = 2)} class="btn btn-primary w-full">Neste</button>

				{:else}
					{#await data}
						<div class="flex justify-center py-12">
							<span class="loading loading-spinner loading-lg text-primary"></span>
						</div>
					{:then flats}
						<h1 class="card-title text-xl mb-1">Nye satser</h1>
						<p class="text-sm text-base-content/60 mb-4">
							Gjelder fra {MONTHS[fromMonth - 1]} {fromYear}
						</p>

						<label class="flex items-center gap-2 text-sm cursor-pointer mb-4">
							<input type="checkbox" bind:checked={autoFill} class="checkbox checkbox-sm" />
							Fyll ut automatisk basert på sameiebrøk
						</label>

						<table class="table table-sm mb-4">
							<thead>
								<tr>
									<th>Nr.</th>
									<th>Bruksenhet</th>
									<th>Brøk</th>
									<th>Gjeldende</th>
									<th>Ny (kr/mnd)</th>
								</tr>
							</thead>
							<tbody>
								{#each flats as f}
									<tr>
										<td class="tabular-nums">{f.nummer}</td>
										<td class="font-mono">{f.flatNo}</td>
										<td class="tabular-nums">{f.shareNumerator}/{f.shareDenominator}</td>
										<td class="tabular-nums text-base-content/60 text-sm">
											{#if f.currentRentAmount !== null}
												{(f.currentRentAmount / 100).toLocaleString('nb-NO')} kr
											{:else}
												<span class="text-base-content/30">—</span>
											{/if}
										</td>
										<td>
											<input
												type="number"
												bind:value={amounts[f.id]}
												onblur={() => fillFromShare(flats, f.id)}
												min="1"
												step="1"
												placeholder="0"
												class="input input-bordered input-sm w-28 tabular-nums"
											/>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>

						{#if error}
							<div role="alert" class="alert alert-error alert-soft mb-3">
								<span>{error}</span>
							</div>
						{/if}
						{#if success}
							<div role="alert" class="alert alert-success alert-soft mb-3">
								<span>Husleie oppdatert.</span>
							</div>
						{/if}

						<div class="flex gap-2">
							<button onclick={() => (step = 1)} class="btn btn-ghost">Tilbake</button>
							<button onclick={() => handleSubmit(flats)} disabled={saving} class="btn btn-primary flex-1">
								{#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
								Lagre
							</button>
						</div>
					{:catch err}
						<div role="alert" class="alert alert-error">
							<span>{errorMessage(err)}</span>
						</div>
					{/await}
				{/if}

			</div>
		</div>

	</div>
</div>
