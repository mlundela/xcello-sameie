<script lang="ts">
    import {authClient} from '$lib/auth-client';
    import {afterNavigate, goto, refreshAll} from '$app/navigation';
    import {page} from '$app/state';
    import {errorMessage} from '$lib/notify.svelte';
    import {get_layout_data} from './layout.remote';

    const {children} = $props();

    const data = get_layout_data();

    // The drawer (below lg) closes once a menu link has navigated
    let navOpen = $state(false);
    afterNavigate(() => (navOpen = false));

    async function switchOrg(organizationId: string) {
        await authClient.organization.setActive({organizationId});
        // Every cached query holds the previous sameie's data, and the current page (a flat,
        // a transaction) may not exist in the new one. Leave it first, then refetch everything.
        await goto('/dashboard');
        await refreshAll();
    }

    async function signOut() {
        await authClient.signOut();
        goto('/login');
    }

    function isActive(path: string) {
        return page.url.pathname === path;
    }
</script>

{#await data}
    <div class="flex min-h-screen items-center justify-center bg-base-200">
        <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
{:then {user, activeOrg, organizations}}
    {@const meta = activeOrg?.metadata ? JSON.parse(activeOrg.metadata) : {}}
    <!-- Sidebar below lg is a drawer behind a menu button -->
    <div class="drawer lg:drawer-open">
        <input id="nav-drawer" type="checkbox" class="drawer-toggle" bind:checked={navOpen}/>

        <div class="drawer-content flex flex-col min-h-screen bg-base-200 min-w-0">
            <header class="navbar bg-base-100 border-b border-base-200 lg:hidden">
                <label for="nav-drawer" class="btn btn-square btn-ghost" aria-label="Åpne meny">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                </label>
                <span class="font-bold text-primary truncate">{activeOrg?.name ?? 'Xcello Sameie'}</span>
            </header>
            {@render children()}
        </div>

        <div class="drawer-side z-40">
        <label for="nav-drawer" class="drawer-overlay" aria-label="Lukk meny"></label>
        <aside class="w-56 min-h-full bg-base-200 border-r border-base-100 flex flex-col">

            <!-- App name -->
            <div class="px-6 pt-6 pb-4 border-b border-base-100">
                <span class="text-lg font-bold text-primary">Xcello Sameie</span>
            </div>

            <!-- Aktivt sameie -->
            <div class="px-4 py-4 border-b border-base-100 flex flex-col gap-2">
                {#if organizations.length > 1}
                    <select
                            value={activeOrg?.id ?? ''}
                            onchange={(e) => switchOrg(e.currentTarget.value)}
                            aria-label="Aktivt sameie"
                            class="select select-bordered select-sm font-semibold w-full"
                    >
                        {#each organizations as org}
                            <option value={org.id}>{org.name}</option>
                        {/each}
                    </select>
                {:else if activeOrg}
                    <p class="font-semibold text-sm ml-2 mt-2">{activeOrg.name}</p>
                {:else}
                    <p class="text-sm text-base-content/40">Ingen sameie</p>
                {/if}
                {#if activeOrg}
                    <div class="flex flex-col gap-1 text-xs text-base-content/60 pl-2">
                        {#if meta.orgNo}
                            <p class="mt-2 text-base-content/40">Organisasjonsnummer</p>
                            <p class="">{meta.orgNo}</p>
                        {/if}
                        {#if meta.address}
                            <p class="mt-2 text-base-content/40">Adresse</p>
                            <p class="">{meta.address}</p>
                            <p class="">{meta.postalCode} {meta.city}</p>
                            <p class="text-base-content/40 font-mono">{meta.addressId}</p>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Navigation -->
            <nav class="flex-1 p-2">
                <ul class="menu menu-md gap-0.5">
                    <li>
                        <a href="/dashboard" class:menu-active={isActive('/dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                            </svg>
                            Hjem
                        </a>
                    </li>
                    <li>
                        <a href="/flats" class:menu-active={isActive('/flats')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                            </svg>
                            Leiligheter
                        </a>
                    </li>

                    <li>
                        <a href="/transaksjoner" class:menu-active={page.url.pathname.startsWith('/transaksjoner')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                            </svg>
                            Transaksjoner
                        </a>
                    </li>


                    <li>
                        <a href="/rapporter" class:menu-active={page.url.pathname.startsWith('/rapporter')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                            Rapporter
                        </a>
                    </li>

                    <li>
                        <a href="/kontoplan" class:menu-active={page.url.pathname.startsWith('/kontoplan')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
                            </svg>
                            Kontoplan
                        </a>
                    </li>

                    <li>
                        <a href="/matchingsregler" class:menu-active={page.url.pathname.startsWith('/matchingsregler')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                            </svg>
                            Matchingsregler
                        </a>
                    </li>

                    <li>
                        <a href="/members" class:menu-active={isActive('/members')}>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                            </svg>
                            Brukere
                        </a>
                    </li>
                </ul>
            </nav>

            <!-- User dropdown -->
            <div class="p-2 border-t border-base-200">
                <details class="dropdown dropdown-top w-full">
                    <summary
                            class="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-base-200 cursor-pointer list-none w-full">
                        <div class="avatar avatar-placeholder">
                            <div class="bg-primary text-primary-content rounded-full w-8 text-xs font-bold">
                                <span>{user.name.charAt(0).toUpperCase()}</span>
                            </div>
                        </div>
                        <div class="flex flex-col min-w-0">
                            <p class="text-xs font-medium truncate">{user.name}</p>
                            <p class="text-xs text-base-content/50 truncate">{user.email}</p>
                        </div>
                    </summary>
                    <ul class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-200 w-52 mb-1">
                        <li><a href="/organizations/new">+ Nytt sameie</a></li>
                        <li>
                            <button onclick={signOut} class="text-error">Logg ut</button>
                        </li>
                    </ul>
                </details>
            </div>

        </aside>
        </div>
    </div>
{:catch err}
    <div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
        <div role="alert" class="alert alert-error">
            <span>{errorMessage(err)}</span>
            <a href="/login" class="btn btn-sm">Logg inn på nytt</a>
        </div>
    </div>
{/await}
