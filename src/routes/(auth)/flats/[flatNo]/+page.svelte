<script lang="ts">
    import { formatKr } from '$lib/money';
    import { errorMessage } from '$lib/notify.svelte';
    import {page} from '$app/state';
    import {get_flat, set_payment_responsible} from './flat.remote';

    const flatNo = page.params.flatNo ?? '';
    const data = get_flat({flatNo});
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
                                {#if currentOwners.length > 1}
                                    <input
                                        type="radio"
                                        class="radio radio-sm mt-0.5"
                                        name="payment-responsible"
                                        checked={ownership.isPaymentResponsible}
                                        onchange={() => set_payment_responsible({ flatNo, ownerId: owner.id })}
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
        {/if}

    {:catch err}
        <div role="alert" class="alert alert-error">
            <span>{errorMessage(err)}</span>
        </div>
    {/await}
</main>
