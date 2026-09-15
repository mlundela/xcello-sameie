<script lang="ts">
    import { errorMessage, showError } from '$lib/notify.svelte';
    import { roleLabel } from '$lib/roles';
    import PageHeader from '$lib/PageHeader.svelte';
    import {goto, refreshAll} from '$app/navigation';
    import {cancel_invite, get_members_data, invite_member, leave_organization, remove_member, update_member_role} from './members.remote';

    const data = get_members_data();

    let email = $state('');
    let role = $state<'member' | 'admin'>('member');
    let inviteError = $state('');
    let inviteSuccess = $state(false);
    let loading = $state(false);
    let leaveError = $state('');

    async function handleInvite(e: SubmitEvent) {
        e.preventDefault();
        inviteError = '';
        inviteSuccess = false;
        loading = true;
        try {
            await invite_member({email, role});
            email = '';
            inviteSuccess = true;
        } catch (err) {
            inviteError = errorMessage(err, 'Kunne ikke sende invitasjonen');
        } finally {
            loading = false;
        }
    }

    async function handleCancel(invitationId: string) {
        try {
            await cancel_invite({invitationId});
        } catch (err) {
            showError(err);
        }
    }

    async function handleRemove(memberId: string) {
        try {
            await remove_member({memberId});
        } catch (err) {
            showError(err);
        }
    }

    async function handleLeave() {
        leaveError = '';
        try {
            await leave_organization({});
            // The active sameie changed: leave the page, then refetch everything
            await goto('/dashboard');
            await refreshAll();
        } catch (err) {
            leaveError = errorMessage(err);
        }
    }

    async function handleRoleChange(select: HTMLSelectElement, memberId: string, previousRole: string) {
        try {
            await update_member_role({memberId, role: select.value as 'member' | 'admin'}).updates(data);
        } catch (err) {
            select.value = previousRole;
            showError(err);
        }
    }
</script>

<main class="max-w-lg px-4 sm:px-6 py-8 flex flex-col gap-6">
    <PageHeader crumbs={[]} title="Brukere"/>
    {#if leaveError}
        <div role="alert" class="alert alert-error">
            <span>{leaveError}</span>
        </div>
    {/if}

    {#await data}
        <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
    {:then {members, pendingInvites, isAdmin, currentUserId}}
        <div class="card bg-base-100">
            <div class="card-body gap-4">
                <h2 class="card-title">Medlemmer</h2>
                <ul class="flex flex-col divide-y divide-base-200">
                    {#each members as m (m.id)}
                        <li class="flex items-center justify-between py-3">
                            <div>
                                <p class="font-medium">{m.name}</p>
                                <p class="text-base-content/70">{m.email}</p>
                            </div>
                            <div class="flex items-center gap-2">
                                {#if isAdmin && m.userId !== currentUserId && m.role !== 'owner'}
                                    <select
                                        class="select select-bordered select-sm w-auto"
                                        aria-label="Rolle for {m.name}"
                                        value={m.role}
                                        onchange={(e) => handleRoleChange(e.currentTarget, m.id, m.role)}
                                    >
                                        <option value="member">{roleLabel('member')}</option>
                                        <option value="admin">{roleLabel('admin')}</option>
                                    </select>
                                {:else}
                                    <span class="badge {m.role === 'member' ? 'badge-ghost' : 'badge-primary'} badge-soft badge-sm">
                                        {roleLabel(m.role)}
                                    </span>
                                {/if}
                                {#if m.userId === currentUserId}
                                    <button onclick={handleLeave} class="btn btn-ghost btn-sm text-error">
                                        Forlat
                                    </button>
                                {:else if isAdmin}
                                    <button onclick={() => handleRemove(m.id)} class="btn btn-ghost btn-sm text-error">
                                        Fjern
                                    </button>
                                {/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            </div>
        </div>

        {#if isAdmin}
            {#if pendingInvites.length > 0}
                <div class="card bg-base-100">
                    <div class="card-body gap-4">
                        <h2 class="card-title">Ventende invitasjoner</h2>
                        <ul class="flex flex-col divide-y divide-base-200">
                            {#each pendingInvites as inv (inv.id)}
                                <li class="flex items-center justify-between py-3">
                                    <div>
                                        <p class="font-medium">{inv.email}</p>
                                        <p class="text-base-content/70">
                                            {roleLabel(inv.role ?? 'member')} ·
                                            utløper {new Date(inv.expiresAt).toLocaleDateString('nb-NO')}
                                        </p>
                                    </div>
                                    <button onclick={() => handleCancel(inv.id)}
                                            class="btn btn-ghost btn-sm text-error">
                                        Trekk tilbake
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    </div>
                </div>
            {/if}

            <div class="card bg-base-100">
                <div class="card-body gap-4">
                    <h2 class="card-title">Inviter bruker</h2>
                    <form onsubmit={handleInvite} class="flex flex-col gap-4">
                        <label class="floating-label">
                            <input
                                    type="email"
                                    bind:value={email}
                                    required
                                    autocomplete="off"
                                    placeholder="kollega@eksempel.no"
                                    class="input input-bordered w-full"
                            />
                            <span>E-post</span>
                        </label>

                        <select bind:value={role} aria-label="Rolle" class="select select-bordered w-full">
                            <option value="member">{roleLabel('member')}</option>
                            <option value="admin">{roleLabel('admin')}</option>
                        </select>

                        {#if inviteError}
                            <div role="alert" class="alert alert-error alert-soft">
                                <span>{inviteError}</span>
                            </div>
                        {/if}
                        {#if inviteSuccess}
                            <div role="status" class="alert alert-success alert-soft">
                                <span>Invitasjonen er sendt.</span>
                            </div>
                        {/if}

                        <button type="submit" disabled={loading} class="btn btn-primary w-full">
                            {#if loading}
                                <span class="loading loading-spinner loading-sm"></span>
                            {/if}
                            Send invitasjon
                        </button>
                    </form>
                </div>
            </div>
        {/if}
    {:catch err}
        <div role="alert" class="alert alert-error">
            <span>{errorMessage(err)}</span>
        </div>
    {/await}
</main>
