<script lang="ts">
	import { untrack } from 'svelte';
	import { get_attachments, upload_attachment, delete_attachment, update_description } from './banktransaksjoner.remote';

	let {
		transactionId,
		bankDescription,
		userDescription: initialUserDescription,
		onUpdate
	}: {
		transactionId: string;
		bankDescription: string;
		userDescription: string | null;
		onUpdate: () => void;
	} = $props();

	let userDescription = $state(untrack(() => initialUserDescription ?? ''));
	let attachmentsQuery = $derived(get_attachments({ transactionId }));
	let fileInput = $state<HTMLInputElement>();
	let uploading = $state(false);
	let uploadError = $state('');

	async function saveDescription() {
		const val = userDescription.trim() || null;
		await update_description({ transactionId, userDescription: val });
		onUpdate();
	}

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
			const content = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve((reader.result as string).split(',')[1]);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
			await upload_attachment({
				transactionId,
				fileName: file.name,
				mimeType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp',
				content
			}).updates(attachmentsQuery);
			onUpdate();
		} catch (err: unknown) {
			uploadError = err instanceof Error ? err.message : 'Opplasting feilet';
		} finally {
			uploading = false;
			input.value = '';
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div class="grid grid-cols-2 gap-4">
		<div>
			<p class="label text-xs text-base-content/50">Bankbeskrivelse</p>
			<p class="text-sm text-base-content/60">{bankDescription}</p>
		</div>
		<div>
			<label for="user-desc" class="label text-xs">Din beskrivelse</label>
			<input
				id="user-desc"
				type="text"
				class="input input-bordered input-sm w-full"
				bind:value={userDescription}
				onblur={saveDescription}
				placeholder="Legg til beskrivelse..."
			/>
		</div>
	</div>

	<div>
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs font-medium">Vedlegg</span>
			<button class="btn btn-ghost btn-xs" disabled={uploading} onclick={() => fileInput!.click()}>
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
			<p class="text-error text-xs mb-2">{uploadError}</p>
		{/if}

		{#await attachmentsQuery then attachments}
			{#if attachments.length === 0}
				<p class="text-xs text-base-content/40">Ingen vedlegg</p>
			{:else}
				<ul class="flex flex-col gap-1">
					{#each attachments as att}
						<li class="flex items-center gap-2 text-sm">
							<a
								href="data:{att.mimeType};base64,{att.content}"
								download={att.fileName}
								class="link link-primary text-xs truncate flex-1"
							>{att.fileName}</a>
							<button
								class="btn btn-ghost btn-xs text-error"
								onclick={() => { delete_attachment({ attachmentId: att.id }).updates(attachmentsQuery); onUpdate(); }}
							>Slett</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/await}
	</div>
</div>
