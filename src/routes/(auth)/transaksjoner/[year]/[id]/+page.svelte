<script lang="ts">
	import { formatKr } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import { readAsBase64 } from '$lib/file';
	import KategoriSelect from '../KategoriSelect.svelte';
	import {
		get_transaction,
		get_attachments,
		update_description,
		upload_attachment,
		delete_attachment,
		match_transaction,
		unmatch_transaction,
		categorize_transaction,
		set_receipt_not_required
	} from '../banktransaksjoner.remote';
	import { get_rules } from '../../../matchingsregler/matchingsregler.remote';
	import { get_accounts } from '../../../kontoplan/kontoplan.remote';

	const id = $derived(page.params.id!);
	const year = $derived(page.params.year!);

	const txQuery = $derived(get_transaction({ id }));
	let attachmentsQuery = $derived(get_attachments({ transactionId: id }));
	const rulesData = get_rules();
	const accountsData = get_accounts();

	let fileInput = $state<HTMLInputElement>();
	let uploading = $state(false);
	let uploadError = $state('');
	let userDesc = $state('');
	let editingDesc = $state(false);

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > 10 * 1024 * 1024) {
			uploadError = 'Filen er for stor (maks 10 MB)';
			return;
		}
		uploading = true;
		uploadError = '';
		try {
			const content = await readAsBase64(file);
			await upload_attachment({
				transactionId: id,
				fileName: file.name,
				mimeType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp',
				content
			}).updates(attachmentsQuery);
		} catch (err: unknown) {
			uploadError = errorMessage(err, 'Opplasting feilet');
		} finally {
			uploading = false;
			input.value = '';
		}
	}
</script>

{#await Promise.all([txQuery, rulesData, accountsData])}
	<div class="flex justify-center py-12">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:then [tx, { owners }, accounts]}
	{@const isIncome = tx.amountOre > 0}
	{@const typeLabel = isIncome ? 'Innbetalinger' : 'Utbetalinger'}
	{@const typeParam = isIncome ? 'income' : 'expense'}

	<main class="max-w-2xl px-6 py-8 flex flex-col gap-6">
		<div class="breadcrumbs text-sm">
			<ul>
				<li><a href="/dashboard">Hjem</a></li>
				<li><a href="/transaksjoner/{year}?type={typeParam}">{typeLabel}</a></li>
				<li>{tx.userDescription ?? tx.description}</li>
			</ul>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<div class="flex items-center gap-3">
					<h2 class="card-title">{isIncome ? 'Innbetaling' : 'Utbetaling'}</h2>
					{#await attachmentsQuery then atts}
						{@const s = tx.status === 'CATEGORIZED' || tx.status === 'MATCHED'
							? atts.length > 0 || tx.receiptNotRequired
								? { label: 'Ferdig', cls: 'badge-success badge-soft' }
								: { label: 'Mangler kvittering', cls: 'badge-warning badge-soft' }
							: { label: 'Ukoblet', cls: 'badge-warning badge-soft' }}
						<span class="badge badge-sm {s.cls}">{s.label}</span>
					{/await}
				</div>

				<div class="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
					<div>
						<p class="text-base-content/50 text-xs">Dato</p>
						<p>{tx.date}</p>
					</div>
					<div>
						<p class="text-base-content/50 text-xs">Beløp</p>
						<p class="font-mono {isIncome ? 'text-success' : 'text-error'}">{formatKr(tx.amountOre)}</p>
					</div>
					<div>
						<p class="text-base-content/50 text-xs">Fra kontoutskrift</p>
						<p>{tx.fileName}</p>
					</div>
				</div>

				<div class="divider my-0"></div>

				<div class="flex flex-col gap-2">
					<p class="text-xs font-medium">Beskrivelse</p>
					{#if !editingDesc}
						<div class="flex items-center justify-between">
							<div>
								{#if tx.userDescription}
									<p class="text-sm font-medium">{tx.userDescription}</p>
									<p class="text-xs text-base-content/50">{tx.description}</p>
								{:else}
									<p class="text-sm">{tx.description}</p>
								{/if}
							</div>
							{#if page.data.canEdit}
								<button class="btn btn-ghost btn-sm" onclick={() => { userDesc = tx.userDescription ?? ''; editingDesc = true; }}>Endre</button>
							{/if}
						</div>
					{:else}
						<div class="flex gap-2">
							<input
								id="user-desc"
								type="text"
								class="input input-bordered input-sm flex-1"
								bind:value={userDesc}
								placeholder={tx.description}
							/>
							<button
								class="btn btn-sm btn-primary"
								onclick={() => update_description({ transactionId: id, userDescription: userDesc.trim() || null }).updates(txQuery).then(() => (editingDesc = false))}
							>Lagre</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title text-base">Kategorisering</h2>

				{#if tx.status !== 'UNMATCHED'}
					<div class="flex items-center justify-between">
						<div class="text-sm">
							{#if tx.ownerName}
								<span class="text-base-content/50 text-xs block">Koblet til</span>
								{tx.ownerName}
							{:else if tx.ledgerAccountName}
								<span class="text-base-content/50 text-xs block">Konto</span>
								{tx.ledgerAccountCode} {tx.ledgerAccountName}
							{/if}
						</div>
						{#if page.data.canEdit}
							<button
								class="btn btn-ghost btn-sm text-error"
								onclick={() => unmatch_transaction({ transactionId: id }).updates(txQuery)}
							>Fjern</button>
						{/if}
					</div>
				{:else if page.data.canEdit}
					<KategoriSelect
						{isIncome}
						{owners}
						{accounts}
						onpick={(k) => (k.kind === 'owner' ? match_transaction({ transactionId: id, ownerId: k.ownerId }) : categorize_transaction({ transactionId: id, ledgerAccountId: k.ledgerAccountId })).updates(txQuery)}
					/>
				{:else}
					<p class="text-sm text-base-content/50">Ikke kategorisert.</p>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<div class="flex items-center justify-between">
					<h2 class="card-title text-base">Vedlegg</h2>
					<button class="btn btn-sm btn-primary" disabled={uploading || tx.receiptNotRequired} onclick={() => fileInput!.click()}>
						{#if uploading}<span class="loading loading-spinner loading-xs"></span>{/if}
						Last opp
					</button>
					<input
						bind:this={fileInput}
						type="file"
						accept=".pdf,.jpg,.jpeg,.png,.webp"
						class="hidden"
						aria-label="Velg vedlegg"
						onchange={handleFileChange}
					/>
				</div>

				{#if uploadError}
					<div class="alert alert-error py-2 px-4 text-sm">{uploadError}</div>
				{/if}

				{#await attachmentsQuery then attachments}
					{#if attachments.length === 0}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={tx.receiptNotRequired}
								disabled={!page.data.canEdit}
								onchange={(e) => set_receipt_not_required({ transactionId: id, value: e.currentTarget.checked }).updates(txQuery)}
							/>
							<span class="text-sm">Kvittering ikke nødvendig</span>
						</label>
						<p class="text-sm text-base-content/40">Ingen vedlegg lastet opp.</p>
					{:else}
						<ul class="flex flex-col divide-y divide-base-200">
							{#each attachments as att}
								<li class="flex items-center gap-3 py-2">
									<a
										href="/vedlegg/{att.id}"
										target="_blank"
										rel="noopener"
										class="link link-primary text-sm flex-1 truncate"
									>{att.fileName}</a>
									<button
										class="btn btn-ghost btn-xs text-error"
										onclick={() => delete_attachment({ attachmentId: att.id }).updates(attachmentsQuery)}
									>Slett</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/await}
			</div>
		</div>
	</main>
{:catch err}
	<div class="max-w-2xl px-6 py-8">
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	</div>
{/await}
