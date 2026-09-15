<script lang="ts">
	import { krToOre } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { create_organization, get_setup_flats, get_setup_owners, get_setup_state, setup_accounting_periods, set_initial_rent } from './new.remote';

	type GeoAddress = {
		kommunenummer: string;
		adressekode: number;
		nummer: number;
		bokstav: string;
		adressetekstutenadressetilleggsnavn: string;
		postnummer: string;
		poststed: string;
		bruksenhetsnummer: string[];
	};

	let step = $state<1 | 2 | 3>(1);
	let orgNo = $state('');
	let name = $state('');
	let geoAddress = $state<GeoAddress | null>(null);
	let lookupError = $state('');
	let submitError = $state('');
	let loading = $state(false);

	let editingAddress = $state(false);
	let editStreet = $state('');
	let editPostalCode = $state('');
	let editCity = $state('');
	let addressEditError = $state('');

	// Step 2
	let startYear = $state(new Date().getFullYear());
	let bankKr = $state('');
	let loanKr = $state('');

	type SetupOwner = { ownerId: string; ownerName: string; flatNos: string[] };
	let owners = $state<SetupOwner[]>([]);
	let ownerBalanceKr = $state<Record<string, string>>({});

	// Step 3
	type Flat = { id: string; nummer: number; flatNo: string; shareNumerator: number; shareDenominator: number };
	let flats = $state<Flat[]>([]);
	let amounts = $state<Record<string, string>>({});
	let autoFill = $state(true);

	// A sameie whose setup stopped after step 1 continues at step 2 instead of getting a second sameie
	let resumedName = $state('');
	onMount(async () => {
		const setup = await get_setup_state();
		if (!setup.resume) return;
		[flats, owners] = await Promise.all([get_setup_flats(), get_setup_owners()]);
		resumedName = setup.organizationName;
		step = 2;
	});

	function fillFromShare(changedFlatId: string) {
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

	async function lookupOrg() {
		lookupError = '';
		name = '';
		geoAddress = null;

		const digits = orgNo.replace(/\s/g, '');
		if (!/^\d{9}$/.test(digits)) {
			lookupError = 'Organisasjonsnummeret må bestå av 9 siffer.';
			return;
		}

		loading = true;
		try {
			const brreg = await fetch(
				`https://data.brreg.no/enhetsregisteret/api/enheter/${digits}`
			);
			if (!brreg.ok) {
				lookupError = 'Fant ikke organisasjonen. Sjekk organisasjonsnummeret.';
				return;
			}
			const brregData = await brreg.json();
			name = brregData.navn ?? '';

			const adr = brregData.forretningsadresse;
			const addressList = adr.adresse ?? [];
			if (adr) {
				const street = addressList[addressList.length - 1];
				const query = encodeURIComponent(`${street} ${adr.postnummer} ${adr.poststed}`);
				const geo = await fetch(`https://ws.geonorge.no/adresser/v1/sok?sok=${query}`);
				if (geo.ok) {
					const geoData = await geo.json();
					geoAddress = geoData.adresser?.[0] ?? null;
				}
			}

			if (!geoAddress) {
				lookupError = 'Fant ikke adressen i Geonorge.';
			}
		} catch {
			lookupError = 'Kunne ikke hente informasjon.';
		} finally {
			loading = false;
		}
	}

	function startEditAddress() {
		if (!geoAddress) return;
		editStreet = geoAddress.adressetekstutenadressetilleggsnavn;
		editPostalCode = geoAddress.postnummer;
		editCity = geoAddress.poststed;
		addressEditError = '';
		editingAddress = true;
	}

	async function confirmAddressEdit() {
		addressEditError = '';
		loading = true;
		try {
			const query = encodeURIComponent(`${editStreet} ${editPostalCode} ${editCity}`);
			const geo = await fetch(`https://ws.geonorge.no/adresser/v1/sok?sok=${query}`);
			if (geo.ok) {
				const geoData = await geo.json();
				const found = geoData.adresser?.[0] ?? null;
				if (found) {
					geoAddress = found;
					editingAddress = false;
				} else {
					addressEditError = 'Fant ikke adressen i Geonorge. Prøv en mer spesifikk adresse.';
				}
			} else {
				addressEditError = 'Geonorge-oppslag feilet.';
			}
		} catch {
			addressEditError = 'Kunne ikke hente adresse.';
		} finally {
			loading = false;
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!geoAddress) return;
		submitError = '';
		loading = true;
		try {
			await create_organization({
				orgNo: orgNo.replace(/\s/g, ''),
				name,
				addressId: `${geoAddress.kommunenummer}/${geoAddress.adressekode}/${geoAddress.nummer}/${geoAddress.bokstav}`,
				address: geoAddress.adressetekstutenadressetilleggsnavn,
				postalCode: geoAddress.postnummer,
				city: geoAddress.poststed
			});
			// The Matrikkel import runs inside organization creation, so its result is already stored
			[flats, owners] = await Promise.all([get_setup_flats(), get_setup_owners()]);
			step = 2;
		} catch (err: unknown) {
			submitError = errorMessage(err, 'Noe gikk galt.');
		} finally {
			loading = false;
		}
	}

	async function handleSetupPeriods() {
		loading = true;
		submitError = '';
		try {
			const ownerBalances = owners.map((o) => ({
				ownerId: o.ownerId,
				balanceOre: krToOre(ownerBalanceKr[o.ownerId] ?? '0')
			}));
			await setup_accounting_periods({
				startYear,
				bankOre: krToOre(bankKr),
				loanOre: krToOre(loanKr),
				ownerBalances
			});
			step = 3;
		} catch (err: unknown) {
			submitError = errorMessage(err, 'Noe gikk galt.');
		} finally {
			loading = false;
		}
	}

	async function handleFinish() {
		const rents = flats.map((f) => ({
			flatId: f.id,
			amountKr: Math.round(Number(amounts[f.id] ?? 0))
		}));
		if (rents.some((r) => !r.amountKr || r.amountKr <= 0)) {
			submitError = 'Fyll inn gyldig beløp for alle leiligheter';
			return;
		}
		submitError = '';
		loading = true;
		try {
			await set_initial_rent({ fromYear: startYear, rents });
			goto('/dashboard');
		} catch (err: unknown) {
			submitError = errorMessage(err, 'Noe gikk galt.');
		} finally {
			loading = false;
		}
	}
</script>

<div class="min-h-screen bg-base-200 flex items-start justify-center px-4 py-8">
	<div class="w-full max-w-md flex flex-col gap-6">
		<!-- Step indicator -->
		<ul class="steps w-full">
			<li class="step" class:step-primary={step >= 1}>Organisasjon</li>
			<li class="step" class:step-primary={step >= 2}>Regnskapsår</li>
			<li class="step" class:step-primary={step >= 3}>Husleie</li>
		</ul>

		<div class="card bg-base-100 shadow-xl">
			<div class="card-body gap-4">

				{#if step === 1}
					<h1 class="text-2xl font-bold">Ny organisasjon</h1>
					<form onsubmit={handleSubmit} class="flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							<div class="join w-full">
								<input
									type="text"
									bind:value={orgNo}
									aria-label="Organisasjonsnummer"
									placeholder="123 456 789"
									class="input input-bordered join-item flex-1"
								/>
								<button
									type="button"
									onclick={lookupOrg}
									disabled={loading}
									class="btn join-item btn-neutral"
								>
									{#if loading}
										<span class="loading loading-spinner loading-sm"></span>
									{/if}
									Hent info
								</button>
							</div>
							{#if lookupError}
								<div role="alert" class="alert alert-error alert-soft">
									<span>{lookupError}</span>
								</div>
							{/if}
						</div>

						{#if geoAddress}
							<div class="flex flex-col gap-1">
								<p class="text-sm font-medium">Navn</p>
								<p class="font-medium">{name}</p>
							</div>

							{#if editingAddress}
								<div class="flex flex-col gap-4">
									<label class="floating-label">
										<input
											type="text"
											bind:value={editStreet}
											placeholder="Gateadresse"
											class="input input-bordered w-full"
										/>
										<span>Gateadresse</span>
									</label>
									<div class="flex gap-3">
										<label class="floating-label w-28">
											<input
												type="text"
												bind:value={editPostalCode}
												placeholder="Postnummer"
												class="input input-bordered w-full"
											/>
											<span>Postnummer</span>
										</label>
										<label class="floating-label flex-1">
											<input
												type="text"
												bind:value={editCity}
												placeholder="Poststed"
												class="input input-bordered w-full"
											/>
											<span>Poststed</span>
										</label>
									</div>
									{#if addressEditError}
										<div role="alert" class="alert alert-error alert-soft">
											<span>{addressEditError}</span>
										</div>
									{/if}
									<div class="flex gap-2">
										<button
											type="button"
											onclick={confirmAddressEdit}
											disabled={loading}
											class="btn btn-primary flex-1"
										>
											{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
											Bekreft
										</button>
										<button
											type="button"
											onclick={() => (editingAddress = false)}
											disabled={loading}
											class="btn btn-ghost"
										>
											Avbryt
										</button>
									</div>
								</div>
							{:else}
								<div class="bg-base-200 rounded-box p-4 flex flex-col gap-3">
									<div class="flex flex-col gap-1">
										<p class="font-medium">{geoAddress.adressetekstutenadressetilleggsnavn}</p>
										<p class="text-base-content/70">{geoAddress.postnummer} {geoAddress.poststed}</p>
										<p class="text-xs font-mono text-base-content/60">{geoAddress.kommunenummer}/{geoAddress.adressekode}/{geoAddress.nummer}/{geoAddress.bokstav}</p>
									</div>
									<button
										type="button"
										onclick={startEditAddress}
										class="btn btn-ghost btn-sm self-start"
									>
										Rediger adresse
									</button>
								</div>
							{/if}

							{#if geoAddress.bruksenhetsnummer.length > 0}
								<div class="flex flex-col gap-1">
									<p class="text-sm font-medium">Bruksenheter</p>
									<div class="flex flex-wrap gap-2">
										{#each geoAddress.bruksenhetsnummer as enhet}
											<span class="badge badge-ghost badge-sm">{enhet}</span>
										{/each}
									</div>
								</div>
							{/if}

							{#if submitError}
								<div role="alert" class="alert alert-error alert-soft">
									<span>{submitError}</span>
								</div>
							{/if}

							<button
								type="submit"
								disabled={loading || !name || editingAddress}
								class="btn btn-primary w-full"
							>
								{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
								Opprett organisasjon
							</button>
						{/if}
					</form>

				{:else if step === 2}
					<h1 class="text-2xl font-bold">Regnskapsår</h1>
					{#if resumedName}
						<p>
							Fortsetter oppsettet av <span class="font-medium">{resumedName}</span>.
							<button type="button" class="link" onclick={() => { resumedName = ''; step = 1; }}>Opprett et annet sameie</button>
						</p>
					{/if}
					<p class="text-base-content/70">
						Velg første regnskapsår og legg inn inngående saldo per 1. januar det året.
					</p>
					<div class="flex flex-col gap-4">
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium">Start-år</span>
							<input
								type="number"
								bind:value={startYear}
								min="2000"
								max={new Date().getFullYear()}
								class="input input-bordered w-32 tabular-nums"
							/>
						</label>

						<h2 class="divider my-0 text-sm font-semibold text-base-content/70">Inngående saldo 1. jan {startYear}</h2>

						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium">Banksaldo (kr)</span>
							<input
								type="text"
								inputmode="decimal"
								bind:value={bankKr}
								placeholder="0,00"
								class="input input-bordered tabular-nums"
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium">Utestående lån (kr)</span>
							<input
								type="text"
								inputmode="decimal"
								bind:value={loanKr}
								placeholder="0,00"
								class="input input-bordered tabular-nums"
							/>
							<span class="text-xs text-base-content/60">La stå blank eller 0 hvis sameiet ikke har lån.</span>
						</label>

						{#if owners.length > 0}
							<h2 class="divider my-0 text-sm font-semibold text-base-content/70">Eierbalanse 1. jan {startYear}</h2>
							<p class="text-base-content/70">
								Positiv = eier har til gode (forhåndsbetalt). Negativ = eier skylder (fordring). La stå blankt hvis alt er i orden.
							</p>
							<div class="flex flex-col gap-2">
								{#each owners as o}
									<div class="flex items-center gap-3">
										<div class="flex-1 min-w-0">
											<p class="text-sm truncate">{o.ownerName}</p>
											<p class="text-base-content/70">{o.flatNos.join(', ')}</p>
										</div>
										<input
											type="text"
											inputmode="decimal"
											bind:value={ownerBalanceKr[o.ownerId]}
											aria-label="Inngående saldo for {o.ownerName}"
											placeholder="0,00"
											class="input input-bordered input-sm w-28 text-right tabular-nums"
										/>
										<span class="text-base-content/60 w-4">kr</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-base-content/70">
								Fant ingen eiere i Matrikkel. Eierbalanser kan legges inn senere under Rapporter.
							</p>
						{/if}

						{#if submitError}
							<div role="alert" class="alert alert-error alert-soft">
								<span>{submitError}</span>
							</div>
						{/if}
						<button onclick={handleSetupPeriods} disabled={loading || !bankKr} class="btn btn-primary w-full">
							{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
							Neste
						</button>
					</div>

				{:else}
					<h1 class="text-2xl font-bold">Sett husleie</h1>
					<p class="text-base-content/70">
						Sett startbeløp per leilighet fra januar {startYear}.
					</p>

					{#if flats.length === 0}
						<div role="alert" class="alert alert-warning alert-soft">
							<span>Fant ingen seksjoner i Matrikkel for denne adressen, så husleie kan ikke settes nå.</span>
						</div>
						<button onclick={() => goto('/dashboard')} class="btn btn-primary w-full">Gå til oversikten</button>
					{:else}
						<label class="flex items-center gap-2 text-sm cursor-pointer">
							<input type="checkbox" bind:checked={autoFill} class="checkbox checkbox-sm" />
							Fyll ut øvrige husleier automatisk basert på sameiebrøk
						</label>
						<div class="overflow-x-auto"><table class="table">
							<thead>
								<tr>
									<th>Nr.</th>
									<th>Bruksenhet</th>
									<th>Brøk</th>
									<th>Kr/mnd</th>
								</tr>
							</thead>
							<tbody>
								{#each flats as f}
									<tr>
										<td class="tabular-nums">{f.nummer}</td>
										<td class="font-mono">{f.flatNo}</td>
										<td class="tabular-nums">{f.shareNumerator}/{f.shareDenominator}</td>
										<td class="py-0">
											<input
												type="number"
												bind:value={amounts[f.id]}
												onblur={() => fillFromShare(f.id)}
												aria-label="Husleie for {f.flatNo}"
												min="1"
												step="1"
												placeholder="0"
												class="input input-bordered input-sm w-28 tabular-nums"
											/>
										</td>
									</tr>
								{/each}
							</tbody>
						</table></div>

						{#if submitError}
							<div role="alert" class="alert alert-error alert-soft">
								<span>{submitError}</span>
							</div>
						{/if}

						<button onclick={handleFinish} disabled={loading} class="btn btn-primary w-full">
							{#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
							Fullfør
						</button>
					{/if}
				{/if}

			</div>
		</div>
	</div>
</div>
