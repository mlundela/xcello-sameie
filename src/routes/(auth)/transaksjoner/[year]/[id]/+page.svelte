<script lang="ts">
	import { formatKr } from '$lib/money';
	import { errorMessage } from '$lib/notify.svelte';
	import { page } from '$app/state';
	import PageHeader from '$lib/PageHeader.svelte';
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
	let uploadError = $state('');
	let userDesc = $state('');
	let editingDesc = $state(false);

	// Picking a file submits the form. The size check here only saves uploading a file the server refuses.
	function handleFileChange(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		if (file.size > 10 * 1024 * 1024) {
			uploadError = 'Filen er for stor (maks 10 MB)';
			e.currentTarget.value = '';
			return;
		}
		e.currentTarget.form?.requestSubmit();
	}

	const upload = upload_attachment.enhance(async ({ element, fields, submit }) => {
		uploadError = '';
		try {
			if (!(await submit().updates(attachmentsQuery))) uploadError = fields.file.issues()?.[0]?.message ?? 'Opplasting feilet';
		} catch (err: unknown) {
			uploadError = errorMessage(err, 'Opplasting feilet');
		} finally {
			element.reset();
		}
	});
</script>

<main class="max-w-2xl px-4 sm:px-6 py-8 flex flex-col gap-6">
	{#await Promise.all([txQuery, rulesData, accountsData])}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then [tx, { owners }, accounts]}
		{@const isIncome = tx.amountOre > 0}

		<PageHeader crumbs={[{ href: `/transaksjoner/${year}`, label: 'Transaksjoner' }]} title={tx.userDescription ?? tx.description} />

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

				<dl class="grid grid-cols-2 gap-x-4 gap-y-3">
					<div class="flex flex-col gap-1">
						<dt class="text-base-content/70">Dato</dt>
						<dd class="tabular-nums">{tx.date}</dd>
					</div>
					<div class="flex flex-col gap-1">
						<dt class="text-base-content/70">Beløp</dt>
						<dd class="tabular-nums {isIncome ? 'text-success' : 'text-error'}">{formatKr(tx.amountOre)}</dd>
					</div>
					<div class="flex flex-col gap-1">
						<dt class="text-base-content/70">Fra kontoutskrift</dt>
						<dd class="break-all">{tx.fileName}</dd>
					</div>
				</dl>

				<div class="divider my-0"></div>

				<section class="flex flex-col gap-3">
					<h3 class="text-sm font-semibold text-base-content/70">Beskrivelse</h3>
					{#if !editingDesc}
						<div class="flex items-center justify-between gap-3">
							<div>
								{#if tx.userDescription}
									<p class="font-medium">{tx.userDescription}</p>
									<p class="text-base-content/70">{tx.description}</p>
								{:else}
									<p>{tx.description}</p>
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
								aria-label="Egen beskrivelse"
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
				</section>
			</div>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<h2 class="card-title">Kategorisering</h2>

				{#if tx.status !== 'UNMATCHED'}
					<div class="flex items-center justify-between gap-3">
						<dl class="flex flex-col gap-1">
							{#if tx.ownerName}
								<dt class="text-base-content/70">Koblet til</dt>
								<dd>{tx.ownerName}</dd>
							{:else if tx.ledgerAccountName}
								<dt class="text-base-content/70">Konto</dt>
								<dd><span class="font-mono">{tx.ledgerAccountCode}</span> {tx.ledgerAccountName}</dd>
							{/if}
						</dl>
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
						label="Kategoriser transaksjonen"
						onpick={(k) => (k.kind === 'owner' ? match_transaction({ transactionId: id, ownerId: k.ownerId }) : categorize_transaction({ transactionId: id, ledgerAccountId: k.ledgerAccountId })).updates(txQuery)}
					/>
				{:else}
					<p class="text-base-content/60">Ikke kategorisert.</p>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100">
			<div class="card-body gap-4">
				<div class="flex items-center justify-between">
					<h2 class="card-title">Vedlegg</h2>
					<form {...upload} enctype="multipart/form-data">
						<input type="hidden" name="transactionId" value={id} />
						<button type="button" class="btn btn-sm btn-primary" disabled={upload_attachment.pending > 0 || tx.receiptNotRequired} onclick={() => fileInput!.click()}>
							{#if upload_attachment.pending > 0}<span class="loading loading-spinner loading-xs"></span>{/if}
							Last opp
						</button>
						<input
							bind:this={fileInput}
							type="file"
							name="file"
							accept=".pdf,.jpg,.jpeg,.png,.webp"
							class="hidden"
							aria-label="Velg vedlegg"
							onchange={handleFileChange}
						/>
					</form>
				</div>

				{#if uploadError}
					<div role="alert" class="alert alert-error alert-soft">{uploadError}</div>
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
							Kvittering ikke nødvendig
						</label>
						<p class="text-base-content/60">Ingen vedlegg lastet opp.</p>
					{:else}
						<ul class="flex flex-col divide-y divide-base-200">
							{#each attachments as att}
								<li class="flex items-center gap-3 py-3">
									<a
										href="/vedlegg/{att.id}"
										target="_blank"
										rel="noopener"
										class="link link-primary flex-1 truncate"
									>{att.fileName}</a>
									<button
										class="btn btn-ghost btn-sm text-error"
										onclick={() => delete_attachment({ attachmentId: att.id }).updates(attachmentsQuery)}
									>Slett</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/await}
			</div>
		</div>
	{:catch err}
		<div role="alert" class="alert alert-error">{errorMessage(err)}</div>
	{/await}
</main>
