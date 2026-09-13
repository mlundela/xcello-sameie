<script lang="ts">
    import { formatKr } from '$lib/money';
    import { errorMessage } from '$lib/notify.svelte';
    import {get_flats} from './flats.remote';
    import {page} from '$app/state';

    const flats = get_flats();
</script>

<main class="max-w-4xl px-6 py-8 flex flex-col gap-4">
    <div class="breadcrumbs text-sm">
        <ul>
            <li><a href="/dashboard">Hjem</a></li>
            <li>Leiligheter</li>
        </ul>
    </div>

    {#await flats}
        <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
    {:then items}

        <div class="card bg-base-100">
            <div class="card-body">

                {#if items.length === 0}
                    <p class=" text-base-content/60">Ingen leiligheter registrert.</p>
                {:else}
                    <table class="table">
                        <thead>
                        <tr class="text-xs">
                            <th>#</th>
                            <th>Bruksenhet</th>
                            <th>Brøk</th>
                            <th>Eiere</th>
                            <th>Husleie</th>
                        </tr>
                        </thead>
                        <tbody>
                        {#each items as f}
                            <tr class="align-top">
                                <td class="tabular-nums">{f.nummer}</td>
                                <td class="font-mono">
                                    <a href="/flats/{f.flatNo}" class="link link-hover">{f.flatNo}</a>
                                </td>
                                <td class="tabular-nums">{f.shareNumerator}/{f.shareDenominator}</td>
                                <td>
                                    {#if f.owners.length === 0 || f.owners[0].owner?.name === 'Personinformasjon mangler'}
                                        <span class="text-base-content/40 text-xs">—</span>
                                    {:else}
                                        {f.owners.map((owner) => owner.owner?.name).join(' & ')}
                                    {/if}
                                </td>
                                <td class="tabular-nums">
                                    {#if f.currentRentAmount !== null}
                                        {formatKr(f.currentRentAmount, { decimals: false })}
                                    {:else}
                                        <span class="text-base-content/40">—</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                        </tbody>
                    </table>
                {/if}
            </div>
        </div>

        {#if page.data.canEdit}
            <div class="card bg-base-100">
                <div class="card-body">
                    <h2 class="card-title">Oppdater husleien</h2>
                    <p>Følg guiden for å endre satsene for husleie</p>
                    <div class="card-actions justify-end">
                        <a href="/husleie" class="btn btn-primary">Gå videre</a>
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
