<script lang="ts">
	import {
		get_transactions,
		get_open_periods,
		import_csv,
		match_transaction,
		categorize_transaction,
		create_rule_and_apply,
		create_expense_rule_and_apply
	} from './banktransaksjoner.remote';
	import { get_rules } from '../../matchingsregler/matchingsregler.remote';
	import { get_accounts } from '../../kontoplan/kontoplan.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	const openPeriods = get_open_periods();
	const rulesData = get_rules();
	const accountsData = get_accounts();

	const year = $derived(parseInt(page.params.year));
	const filter = $derived<'all' | 'income' | 'expense'>(
		page.url.searchParams.get('type') === 'income' ? 'income'
		: page.url.searchParams.get('type') === 'expense' ? 'expense'
		: 'all'
	);

	function txQuery() {
		return get_transactions({ year, type: filter === 'all' ? undefined : filter });
	}
	let transactions = $derived(txQuery());

	let fileInput = $state<HTMLInputElement>();
	let importing = $state(false);
	let importResult = $state<{ imported: number; skipped: number } | null>(null);
	let importError = $state('');

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		importResult = null;
		importError = '';
		try {
			const base64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve((reader.result as string).split(',')[1]);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
			importResult = await import_csv({ csvBase64: base64, fileName: file.name }).updates(txQuery());
		} catch (err: unknown) {
			importError = err instanceof Error ? err.message : 'Ukjent feil';
		} finally {
			importing = false;
			input.value = '';
		}
	}

	function formatKr(ore: number) {
		return (ore / 100).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
	}

	const statusLabel: Record<string, string> = {
		UNMATCHED: 'Ukoblet',
		MATCHED: 'Koblet'
	};

	const statusClass: Record<string, string> = {
		UNMATCHED: 'badge-warning badge-soft',
		MATCHED: 'badge-success badge-soft'
	};

	function effectiveStatus(status: string, attachmentCount: number, receiptNotRequired: boolean): { label: string; cls: string } {
		if (status === 'CATEGORIZED' || status === 'MATCHED') {
			return attachmentCount > 0 || receiptNotRequired
				? { label: 'Ferdig', cls: 'badge-success badge-soft' }
				: { label: 'Mangler kvittering', cls: 'badge-warning badge-soft' };
		}
		return { label: statusLabel[status] ?? status, cls: statusClass[status] ?? '' };
	}

	type PendingAction =
		| { kind: 'income'; transactionId: string; ownerId: string; ownerName: string; description: string }
		| { kind: 'expense'; transactionId: string; ledgerAccountId: string; accountName: string; description: string };

	let pendingAction = $state<PendingAction | null>(null);
	let rulePattern = $state('');
	let ruleUserDescription = $state('');
	let ruleReceiptNotRequired = $state(false);
	let dialogEl = $state<HTMLDialogElement>();

	function openIncomeDialog(transactionId: string, ownerId: string, ownerName: string, description: string) {
		pendingAction = { kind: 'income', transactionId, ownerId, ownerName, description };
		rulePattern = description;
		ruleUserDescription = '';
		ruleReceiptNotRequired = true;
		dialogEl?.showModal();
	}

	function openExpenseDialog(transactionId: string, ledgerAccountId: string, accountName: string, description: string) {
		pendingAction = { kind: 'expense', transactionId, ledgerAccountId, accountName, description };
		rulePattern = description;
		ruleUserDescription = '';
		ruleReceiptNotRequired = false;
		dialogEl?.showModal();
	}

	function closeDialog() {
		dialogEl?.close();
		pendingAction = null;
	}
</script>

<main class="max-w-5xl px-6 py-8 flex flex-col gap-6">
	<div class="breadcrumbs text-sm">
		<ul>
			<li><a href="/dashboard">Hjem</a></li>
			<li>Transaksjoner</li>
		</ul>
	</div>

	{#await openPeriods then periods}
		<div class="flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<label class="text-sm font-medium" for="year-select">År:</label>
				<select
					id="year-select"
					class="select select-bordered select-sm"
					value={year}
					onchange={(e) => goto('/transaksjoner/' + e.currentTarget.value)}
				>
					{#each periods as p}
						<option value={p.year}>{p.year}</option>
					{/each}
				</select>
			</div>

			<div role="tablist" class="tabs tabs-box tabs-sm">
				<button role="tab" class="tab" class:tab-active={filter === 'all'} onclick={() => goto(`/transaksjoner/${year}`)}>Alle</button>
				<button role="tab" class="tab" class:tab-active={filter === 'income'} onclick={() => goto(`/transaksjoner/${year}?type=income`)}>Innbetalinger</button>
				<button role="tab" class="tab" class:tab-active={filter === 'expense'} onclick={() => goto(`/transaksjoner/${year}?type=expense`)}>Utbetalinger</button>
			</div>

			<div class="ml-auto flex items-center gap-2">
				{#if importResult}
					<div class="alert alert-success py-2 px-4 text-sm">
						{importResult.imported} importert, {importResult.skipped} hoppet over
					</div>
				{/if}
				{#if importError}
					<div class="alert alert-error py-2 px-4 text-sm">{importError}</div>
				{/if}
				<button class="btn btn-primary btn-sm" disabled={importing} onclick={() => fileInput!.click()}>
					{#if importing}<span class="loading loading-spinner loading-sm"></span>{/if}
					Importer kontoutskrift
				</button>
				<input bind:this={fileInput} type="file" accept=".csv" class="hidden" aria-label="Velg CSV-fil" onchange={handleFileChange} />
			</div>
		</div>
	{/await}

	{#await Promise.all([transactions, rulesData, accountsData])}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:then [rows, { owners }, accounts]}
		{@const otherIncomeAccounts = accounts.filter((a) => a.type === 'INCOME' && a.code !== '3600')}
		{@const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE')}
		{@const loanAccounts = accounts.filter((a) => a.type === 'LIABILITY')}
		{#if rows.length === 0}
			<div class="card bg-base-100">
				<div class="card-body items-center">
					<p class="text-base-content/60">Ingen transaksjoner for {year}.</p>
				</div>
			</div>
		{:else}
			<div class="card bg-base-100">
				<div class="card-body p-0">
					<table class="table table-sm">
						<thead>
							<tr>
								<th>Dato</th>
								<th>Beskrivelse</th>
								<th class="text-right">Beløp</th>
								<th>Status</th>
								<th>Kategorisering</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row}
								{@const isIncome = row.amountOre > 0}
								{@const s = effectiveStatus(row.status, row.attachmentCount, row.receiptNotRequired)}
								<tr>
									<td class="text-base-content whitespace-nowrap">{row.date}</td>
									<td class="max-w-xs">
										<a href="/transaksjoner/{year}/{row.id}" class="hover:underline truncate">
											{row.userDescription ?? row.description}
										</a>
									</td>
									<td class="text-right font-mono whitespace-nowrap {isIncome ? 'text-success' : 'text-error'}">{formatKr(row.amountOre)}</td>
									<td>
										<span class="badge badge-sm {s.cls}">{s.label}</span>
									</td>
									<td class="text-base-content">
										{#if isIncome}
											{#if row.status === 'UNMATCHED'}
												<select
													class="select select-bordered select-xs"
													onchange={(e) => {
														const val = e.currentTarget.value;
														if (!val) return;
														if (val.startsWith('owner:')) {
															const ownerId = val.slice(6);
															const ownerName = owners.find((o) => o.id === ownerId)?.name ?? '';
															openIncomeDialog(row.id, ownerId, ownerName, row.description);
														} else {
															const accountId = val.slice(8);
															categorize_transaction({ transactionId: row.id, ledgerAccountId: accountId }).updates(txQuery());
														}
														e.currentTarget.value = '';
													}}
												>
													<option value="">Kategoriser...</option>
													{#if owners.length > 0}
														<optgroup label="Felleskostnader">
															{#each owners as o}
																<option value="owner:{o.id}">{o.name}</option>
															{/each}
														</optgroup>
													{/if}
													{#if otherIncomeAccounts.length > 0}
														<optgroup label="Andre inntekter">
															{#each otherIncomeAccounts as a}
																<option value="account:{a.id}">{a.code} {a.name}</option>
															{/each}
														</optgroup>
													{/if}
													{#if loanAccounts.length > 0}
														<optgroup label="Gjeld">
															{#each loanAccounts as a}
																<option value="account:{a.id}">{a.code} {a.name}</option>
															{/each}
														</optgroup>
													{/if}
												</select>
											{:else if row.ownerName}
												{row.ownerName}
											{:else if row.status === 'CATEGORIZED'}
												{row.ledgerAccountCode} {row.ledgerAccountName}
											{/if}
										{:else}
											{#if row.status === 'UNMATCHED'}
												<select
													class="select select-bordered select-xs"
													onchange={(e) => {
														const val = e.currentTarget.value;
														if (!val) return;
														if (val.startsWith('owner:')) {
															match_transaction({ transactionId: row.id, ownerId: val.slice(6) }).updates(txQuery());
														} else {
															const accountName = expenseAccounts.find((a) => a.id === val)?.name ?? '';
															openExpenseDialog(row.id, val, accountName, row.description);
														}
														e.currentTarget.value = '';
													}}
												>
													<option value="">Velg...</option>
													{#if owners.length > 0}
														<optgroup label="Tilbakebetaling til eier">
															{#each owners as o}
																<option value="owner:{o.id}">{o.name}</option>
															{/each}
														</optgroup>
													{/if}
													{#if expenseAccounts.length > 0}
														<optgroup label="Utgifter">
															{#each expenseAccounts as a}
																<option value={a.id}>{a.code} {a.name}</option>
															{/each}
														</optgroup>
													{/if}
													{#if loanAccounts.length > 0}
														<optgroup label="Gjeld">
															{#each loanAccounts as a}
																<option value={a.id}>{a.code} {a.name}</option>
															{/each}
														</optgroup>
													{/if}
												</select>
											{:else if row.ownerName}
												{row.ownerName}
											{:else if row.ledgerAccountName}
												{row.ledgerAccountCode} {row.ledgerAccountName}
											{/if}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{:catch err}
		<div role="alert" class="alert alert-error">{err.message}</div>
	{/await}

	<dialog bind:this={dialogEl} class="modal">
		<div class="modal-box flex flex-col gap-4">
			<h3 class="font-bold text-lg">Lag matchingsregel?</h3>
			{#if pendingAction?.kind === 'income'}
				<p class="text-sm text-base-content/70">
					Vil du lage en regel som automatisk kobler fremtidige innbetalinger til
					<span class="font-semibold">{pendingAction.ownerName}</span>?
				</p>
			{:else if pendingAction?.kind === 'expense'}
				<p class="text-sm text-base-content/70">
					Vil du lage en regel som automatisk kategoriserer fremtidige utgifter på
					<span class="font-semibold">{pendingAction.accountName}</span>?
				</p>
			{/if}
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">Mønster</span>
				<input class="input input-bordered input-sm" bind:value={rulePattern} placeholder="F.eks. «Strøm AS»" />
				<span class="text-xs text-base-content/50">Transaksjoner der beskrivelsen inneholder dette mønsteret kategoriseres automatisk.</span>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">Beskrivelse (valgfri)</span>
				<input class="input input-bordered input-sm" bind:value={ruleUserDescription} placeholder="F.eks. «Strømregning»" />
				<span class="text-xs text-base-content/50">Overstyrer bankens beskrivelse på matchede transaksjoner.</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={ruleReceiptNotRequired} />
				<span class="text-sm">Krever ikke kvittering</span>
			</label>
			<div class="modal-action gap-2">
				<button
					class="btn btn-ghost btn-sm"
					onclick={() => {
						if (!pendingAction) return;
						if (pendingAction.kind === 'income') {
							match_transaction({ transactionId: pendingAction.transactionId, ownerId: pendingAction.ownerId }).updates(txQuery());
						} else {
							categorize_transaction({ transactionId: pendingAction.transactionId, ledgerAccountId: pendingAction.ledgerAccountId }).updates(txQuery());
						}
						closeDialog();
					}}
				>Bare denne</button>
				<button
					class="btn btn-primary btn-sm"
					disabled={!rulePattern}
					onclick={() => {
						if (!pendingAction) return;
						if (pendingAction.kind === 'income') {
							create_rule_and_apply({ pattern: rulePattern, ownerId: pendingAction.ownerId, receiptNotRequired: ruleReceiptNotRequired, userDescription: ruleUserDescription || undefined }).updates(txQuery());
						} else {
							create_expense_rule_and_apply({ pattern: rulePattern, ledgerAccountId: pendingAction.ledgerAccountId, receiptNotRequired: ruleReceiptNotRequired, userDescription: ruleUserDescription || undefined }).updates(txQuery());
						}
						closeDialog();
					}}
				>Lag regel</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>lukk</button>
		</form>
	</dialog>
</main>
