<script module lang="ts">
	export type Kategori =
		| { kind: 'owner'; ownerId: string; ownerName: string }
		| { kind: 'account'; ledgerAccountId: string; accountName: string };
</script>

<script lang="ts">
	type Owner = { id: string; name: string };
	type Account = { id: string; code: string; name: string; type: string };

	let {
		isIncome,
		owners,
		accounts,
		placeholder = 'Velg...',
		label = 'Kategori',
		class: size = 'select-sm',
		onpick
	}: {
		isIncome: boolean;
		owners: Owner[];
		accounts: Account[];
		placeholder?: string;
		label?: string;
		class?: string;
		onpick: (kategori: Kategori) => void;
	} = $props();

	// Innbetalinger: felleskostnader fra eier, andre inntekter, lån. Utbetalinger: tilbakebetaling til eier, utgifter, lån.
	const groups = $derived([
		{
			label: isIncome ? 'Felleskostnader' : 'Tilbakebetaling til eier',
			kind: 'owner',
			options: owners.map((o) => ({ id: o.id, label: o.name }))
		},
		{
			label: isIncome ? 'Andre inntekter' : 'Utgifter',
			kind: 'account',
			options: accounts
				.filter((a) => (isIncome ? a.type === 'INCOME' && a.code !== '3600' : a.type === 'EXPENSE'))
				.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))
		},
		{
			label: 'Gjeld',
			kind: 'account',
			options: accounts.filter((a) => a.type === 'LIABILITY').map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))
		}
	]);

	function onchange(e: Event & { currentTarget: HTMLSelectElement }) {
		const [kind, id] = e.currentTarget.value.split(':');
		e.currentTarget.value = '';
		if (kind === 'owner') onpick({ kind, ownerId: id, ownerName: owners.find((o) => o.id === id)?.name ?? '' });
		else if (kind === 'account') onpick({ kind, ledgerAccountId: id, accountName: accounts.find((a) => a.id === id)?.name ?? '' });
	}
</script>

<select class="select select-bordered {size}" aria-label={label} {onchange}>
	<option value="">{placeholder}</option>
	{#each groups as group (group.label)}
		{#if group.options.length > 0}
			<optgroup label={group.label}>
				{#each group.options as option (option.id)}
					<option value="{group.kind}:{option.id}">{option.label}</option>
				{/each}
			</optgroup>
		{/if}
	{/each}
</select>
