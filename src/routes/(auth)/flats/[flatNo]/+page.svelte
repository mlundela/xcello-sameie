<script lang="ts">
    import { formatKr } from '$lib/money';
    import { errorMessage } from '$lib/notify.svelte';
    import {page} from '$app/state';
    import {get_flat, record_ownership_change, set_payment_responsible} from './flat.remote';

    // Derived: navigating from one flat to another reuses this component
    const flatNo = $derived(page.params.flatNo!);
    const data = $derived(get_flat({flatNo}));

    type NewOwner = { name: string; publicId: string; shareNumerator: number; shareDenominator: number };
    const emptyOwner = (): NewOwner => ({name: '', publicId: '', shareNumerator: 1, shareDenominator: 1});

    let changing = $state(false);
    let changeDate = $state('');
    let newOwners = $state<NewOwner[]>([emptyOwner()]);
    let paymentResponsible = $state(0);
    let changeError = $state('');
    let saving = $state(false);

    function addOwner() {
        newOwners.push(emptyOwner());
        // Two or more owners usually split evenly
        for (const o of newOwners) {
            o.shareNumerator = 1;
            o.shareDenominator = newOwners.length;
        }
    }

    function removeOwner(i: number) {
        newOwners.splice(i, 1);
        if (paymentResponsible >= newOwners.length) paymentResponsible = 0;
    }

    async function saveOwnershipChange(e: SubmitEvent) {
        e.preventDefault();
        changeError = '';
        saving = true;
        try {
            await record_ownership_change({
                flatNo,
                date: changeDate,
                owners: newOwners.map((o) => ({...o, publicId: o.publicId || undefined})),
                paymentResponsible
            }).updates(data);
            changing = false;
            changeDate = '';
            newOwners = [emptyOwner()];
            paymentResponsible = 0;
        } catch (err) {
            changeError = errorMessage(err);
        } finally {
            saving = false;
        }
    }
</script>

<main class="max-w-xl px-6 py-8 flex flex-col gap-4">
    <div class="breadcrumbs text-sm">
        <ul>
            <li><a href="/dashboard">Hjem</a></li>
            <li><a href="/flats">Leiligheter</a></li>
            <li>{flatNo}</li>
        </ul>
    </div>
    {#await data}
        <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
    {:then {flat, history, rentHistory}}
        <div class="card bg-base-100 shadow-sm">
            <div class="card-body">
                <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-3">Seksjon</p>
                <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt class="text-base-content/60">Nummer</dt>
                    <dd class="tabular-nums">{flat.nummer}</dd>
                    <dt class="text-base-content/60">Bruksenhet</dt>
                    <dd class="font-mono">{flat.flatNo}</dd>
                    <dt class="text-base-content/60">Sameiebrøk</dt>
                    <dd class="tabular-nums">{flat.shareNumerator}/{flat.shareDenominator}</dd>
                </dl>
            </div>
        </div>

        {@const currentOwners = history.filter((h) => h.ownership.toDate === null)}
        {#if currentOwners.length > 0}
            <div class="card bg-base-100 shadow-sm">
                <div class="card-body">
                    <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-3">Nåværende
                        eier{currentOwners.length > 1 ? 'e' : ''}</p>
                    <ul class="flex flex-col divide-y divide-base-200">
                        {#each currentOwners as {owner, ownership}}
                            <li class="py-3 flex items-start gap-3">
                                {#if currentOwners.length > 1 && page.data.canEdit}
                                    <input
                                        type="radio"
                                        class="radio radio-sm mt-0.5"
                                        name="payment-responsible"
                                        checked={ownership.isPaymentResponsible}
                                        onchange={() => set_payment_responsible({ flatNo, ownerId: owner.id }).updates(data)}
                                        aria-label="{owner.name} er betalingsansvarlig"
                                    />
                                {/if}
                                <div class="flex flex-col gap-0.5">
                                    <p class="font-medium text-sm">{owner.name}
                                        {#if ownership.isPaymentResponsible && currentOwners.length > 1}
                                            <span class="badge badge-primary badge-soft badge-xs ml-1">Betalingsansvarlig</span>
                                        {/if}
                                    </p>
                                    <p class="text-xs text-base-content/50 tabular-nums">
                                        {owner.publicId} · Fra {ownership.fromDate}
                                        {#if ownership.shareNumerator !== ownership.shareDenominator}
                                            · Andel {ownership.shareNumerator}/{ownership.shareDenominator}
                                        {/if}
                                    </p>
                                </div>
                            </li>
                        {/each}
                    </ul>
                </div>
            </div>
        {/if}

        {#if page.data.canEdit}
            <div class="card bg-base-100 shadow-sm">
                <div class="card-body">
                    {#if !changing}
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-sm text-base-content/70">Er leiligheten solgt?</p>
                            <button class="btn btn-sm" onclick={() => (changing = true)}>Registrer eierskifte</button>
                        </div>
                    {:else}
                        <form onsubmit={saveOwnershipChange} class="flex flex-col gap-3">
                            <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide">Registrer eierskifte</p>
                            <label class="flex flex-col gap-1">
                                <span class="text-sm">Overtakelsesdato</span>
                                <input type="date" bind:value={changeDate} required class="input input-bordered input-sm w-44"/>
                                <span class="text-xs text-base-content/50">Nåværende eiere avsluttes dagen før. Felleskostnader for en måned betales av den som eier leiligheten den 1.</span>
                            </label>

                            {#each newOwners as o, i}
                                <fieldset class="flex flex-wrap items-end gap-2 border-t border-base-200 pt-3">
                                    <legend class="sr-only">Ny eier {i + 1}</legend>
                                    <label class="flex flex-col gap-1 flex-1 min-w-40">
                                        <span class="text-xs">Navn</span>
                                        <input bind:value={o.name} required class="input input-bordered input-sm"/>
                                    </label>
                                    <label class="flex flex-col gap-1 w-36">
                                        <span class="text-xs">Fødselsnr./org.nr. (valgfri)</span>
                                        <input bind:value={o.publicId} class="input input-bordered input-sm"/>
                                    </label>
                                    <label class="flex flex-col gap-1 w-24">
                                        <span class="text-xs">Andel</span>
                                        <span class="flex items-center gap-1">
                                            <input type="number" min="1" bind:value={o.shareNumerator} aria-label="Andel teller" class="input input-bordered input-sm w-12 px-1"/>
                                            /
                                            <input type="number" min="1" bind:value={o.shareDenominator} aria-label="Andel nevner" class="input input-bordered input-sm w-12 px-1"/>
                                        </span>
                                    </label>
                                    <label class="flex items-center gap-1 text-xs pb-2">
                                        <input type="radio" name="new-payment-responsible" value={i} bind:group={paymentResponsible} class="radio radio-xs"/>
                                        Betaler
                                    </label>
                                    {#if newOwners.length > 1}
                                        <button type="button" class="btn btn-ghost btn-xs text-error mb-1" onclick={() => removeOwner(i)}>Fjern</button>
                                    {/if}
                                </fieldset>
                            {/each}

                            <button type="button" class="btn btn-ghost btn-xs self-start" onclick={addOwner}>+ Legg til eier</button>

                            {#if changeError}
                                <div role="alert" class="alert alert-error alert-soft"><span>{changeError}</span></div>
                            {/if}

                            <div class="flex gap-2">
                                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (changing = false)}>Avbryt</button>
                                <button type="submit" class="btn btn-primary btn-sm" disabled={saving}>
                                    {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                    Lagre eierskifte
                                </button>
                            </div>
                        </form>
                    {/if}
                </div>
            </div>
        {/if}

        {@const pastOwners = history.filter((h) => h.ownership.toDate !== null)}
        {#if pastOwners.length > 0}
            <div class="card bg-base-100 shadow-sm">
                <div class="card-body">
                    <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-3">Tidligere eiere</p>
                    <ul class="flex flex-col divide-y divide-base-200">
                        {#each pastOwners as {owner, ownership}}
                            <li class="py-3 flex flex-col gap-0.5">
                                <p class="font-medium text-sm">{owner.name}</p>
                                <p class="text-xs text-base-content/50 tabular-nums">
                                    {owner.publicId} · {ownership.fromDate} – {ownership.toDate}
                                    {#if ownership.shareNumerator !== ownership.shareDenominator}
                                        · Andel {ownership.shareNumerator}/{ownership.shareDenominator}
                                    {/if}
                                </p>
                            </li>
                        {/each}
                    </ul>
                </div>
            </div>
        {/if}


        {#if rentHistory.length > 0}
            {@const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des']}
            <div class="card bg-base-100 shadow-sm">
                <div class="card-body">
                    <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-3">
                        Husleiehistorikk</p>
                    <div class="overflow-x-auto">
                    <table class="table table-sm">
                        <thead>
                        <tr>
                            <th>Fra</th>
                            <th>Til</th>
                            <th>Beløp/mnd</th>
                        </tr>
                        </thead>
                        <tbody>
                        {#each rentHistory as r}
                            <tr>
                                <td class="tabular-nums">{MONTHS[r.fromMonth - 1]} {r.fromYear}</td>
                                <td class="tabular-nums">
                                    {#if r.toYear && r.toMonth}
                                        {MONTHS[r.toMonth - 1]} {r.toYear}
                                    {:else}
                                        <span class="badge badge-success badge-soft badge-sm">Gjeldende</span>
                                    {/if}
                                </td>
                                <td class="tabular-nums">{formatKr(r.amount, { decimals: false })}</td>
                            </tr>
                        {/each}
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>
        {/if}

    {:catch err}
        <div role="alert" class="alert alert-error">
            <span>{errorMessage(err)}</span>
        </div>
    {/await}
</main>
