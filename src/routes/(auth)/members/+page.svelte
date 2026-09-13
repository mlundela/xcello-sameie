<script lang="ts">
    import { errorMessage, showError } from '$lib/notify.svelte';
    import { roleLabel } from '$lib/roles';
    import {goto} from '$app/navigation';
    import {cancel_invite, get_members_data, invite_member, leave_organization, remove_member} from './members.remote';

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
        const result = await leave_organization({});
        if (result?.error) {
            leaveError = result.error;
        } else {
            goto('/dashboard');
        }
    }
</script>

<main class="max-w-lg px-6 py-8 flex flex-col gap-4">
    <div class="breadcrumbs text-sm">
        <ul>
            <li><a href="/dashboard">Hjem</a></li>
            <li>Brukere</li>
        </ul>
    </div>
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
        <div class="card bg-base-100 shadow-sm">
            <div class="card-body">
                <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-2">Medlemmer</p>
                <ul class="flex flex-col divide-y divide-base-200">
                    {#each members as m (m.id)}
                        <li class="flex items-center justify-between py-3">
                            <div>
                                <p class="font-medium text-sm">{m.name}</p>
                                <p class="text-xs text-base-content/60">{m.email}</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="badge {m.role === 'member' ? 'badge-ghost' : 'badge-primary'} badge-soft badge-sm">
                                    {roleLabel(m.role)}
                                </span>
                                {#if m.userId === currentUserId}
                                    <button onclick={handleLeave} class="btn btn-ghost btn-xs text-error">
                                        Forlat
                                    </button>
                                {:else if isAdmin}
                                    <button onclick={() => handleRemove(m.id)} class="btn btn-ghost btn-xs text-error">
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
                <div class="card bg-base-100 shadow-sm">
                    <div class="card-body">
                        <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-2">
                            Ventende invitasjoner
                        </p>
                        <ul class="flex flex-col divide-y divide-base-200">
                            {#each pendingInvites as inv (inv.id)}
                                <li class="flex items-center justify-between py-3">
                                    <div>
                                        <p class="font-medium text-sm">{inv.email}</p>
                                        <p class="text-xs text-base-content/60">
                                            {roleLabel(inv.role ?? 'member')} ·
                                            utløper {new Date(inv.expiresAt).toLocaleDateString('nb-NO')}
                                        </p>
                                    </div>
                                    <button onclick={() => handleCancel(inv.id)}
                                            class="btn btn-ghost btn-xs text-error">
                                        Trekk tilbake
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    </div>
                </div>
            {/if}

            <div class="card bg-base-100 shadow-sm">
                <div class="card-body">
                    <p class="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-2">
                        Inviter bruker
                    </p>
                    <form onsubmit={handleInvite} class="flex flex-col gap-3">
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

                        <select bind:value={role} class="select select-bordered w-full">
                            <option value="member">{roleLabel('member')}</option>
                            <option value="admin">{roleLabel('admin')}</option>
                        </select>

                        {#if inviteError}
                            <div role="alert" class="alert alert-error alert-soft">
                                <span>{inviteError}</span>
                            </div>
                        {/if}
                        {#if inviteSuccess}
                            <div role="alert" class="alert alert-success alert-soft">
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
