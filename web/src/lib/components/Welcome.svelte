<script lang="ts">
	import { SiGithub } from '@icons-pack/svelte-simple-icons';
	import { Images, Upload, X } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import StorageManagementDialog from './StorageManagementDialog.svelte';
	import type { BrowserStorageStatus } from '$lib/browser-storage';
	import type { CleanupResult } from '$lib/library-service';
	import type { StorageBreakdown } from '$lib/storage-breakdown';

	interface Props {
		acceptedPhotos: string;
		sourceReady: boolean;
		ingestError: string | null;
		libraryError: string | null;
		localStorageAvailable: boolean;
		storageStatus: BrowserStorageStatus | null;
		storageBreakdown: StorageBreakdown | null;
		storageError: string | null;
		cleanupResult: CleanupResult | null;
		onOpenPhoto: (file: File) => Promise<void>;
		onCreateCollection: (name: string, files: File[]) => Promise<void>;
		onEnterLibrary: () => void;
		onClearLocalData: () => Promise<void>;
		onRefreshStorage: () => Promise<void>;
		onRequestPersistence: () => Promise<void>;
		onCleanup: () => Promise<void>;
	}

	let {
		acceptedPhotos,
		sourceReady,
		ingestError,
		libraryError,
		localStorageAvailable,
		storageStatus,
		storageBreakdown,
		storageError,
		cleanupResult,
		onOpenPhoto,
		onCreateCollection,
		onEnterLibrary,
		onClearLocalData,
		onRefreshStorage,
		onRequestPersistence,
		onCleanup
	}: Props = $props();
	let newCollectionOpen = $state(false);
	let storageOpen = $state(false);
	let collectionName = $state('');
	let files = $state<File[]>([]);
	let busy = $state(false);
	let openPhotoInput: HTMLInputElement;

	async function openPhoto(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = true;
		try {
			await onOpenPhoto(file);
		} finally {
			busy = false;
		}
	}

	function openStorage() {
		storageOpen = true;
		void onRefreshStorage();
	}

	function chooseFiles(list: FileList | null) {
		if (list) files = [...list];
	}

	function dropFiles(event: DragEvent) {
		event.preventDefault();
		chooseFiles(event.dataTransfer?.files ?? null);
	}

	async function createCollection(event: SubmitEvent) {
		event.preventDefault();
		if (!collectionName.trim()) return;
		busy = true;
		try {
			await onCreateCollection(collectionName, files);
			newCollectionOpen = false;
		} finally {
			busy = false;
		}
	}

	function setCollectionDialogOpen(open: boolean) {
		newCollectionOpen = open;
		if (!open && !busy) onEnterLibrary();
	}
</script>

<main class="flex min-h-svh items-center justify-center bg-bg px-6 text-text">
	<button
		type="button"
		aria-label="Enter photo library"
		title="Enter photo library"
		class="motion-header absolute top-5 right-5 flex size-9 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-text"
		onclick={onEnterLibrary}
		disabled={busy}
	>
		<X size={17} strokeWidth={1.5} />
	</button>

	<a
		href="https://github.com/twangodev/postframe"
		target="_blank"
		rel="noreferrer"
		aria-label="Postframe on GitHub"
		class="motion-enter absolute right-5 bottom-5 flex size-9 items-center justify-center rounded text-muted/70 transition-colors hover:bg-surface hover:text-text"
	>
		<SiGithub size={15} aria-hidden="true" />
	</a>

	{#if localStorageAvailable}
		<button
			type="button"
			class="motion-enter absolute bottom-5 left-5 rounded px-2.5 py-2 text-[11px] text-muted/70 transition-colors hover:bg-surface hover:text-text"
			onclick={openStorage}
		>
			local storage
		</button>
	{/if}

	<section class="motion-enter w-full max-w-md">
		<div class="flex items-center gap-2">
			<img src={postframeLogo} alt="" class="size-7" />
			<span class="text-[14px] font-medium tracking-tight">postframe</span>
		</div>
		<p class="mt-3 text-[14px] text-muted">post-processing built on your JPEGs.</p>

		<div class="mt-8 flex flex-col gap-2 sm:flex-row">
			<input
				bind:this={openPhotoInput}
				type="file"
				accept={acceptedPhotos}
				class="sr-only"
				onchange={openPhoto}
				disabled={busy || !sourceReady}
			/>
			<button
				type="button"
				class="motion-action flex h-9 cursor-pointer items-center justify-center rounded bg-text px-4 text-xs font-medium text-bg hover:opacity-85 sm:flex-1"
				style="--motion-delay: 80ms"
				onclick={() => openPhotoInput.click()}
				disabled={busy || !sourceReady}
			>
				open photo
			</button>

			<button
				type="button"
				class="motion-action flex h-9 cursor-pointer items-center justify-center rounded border border-subtle px-4 text-xs font-medium text-muted hover:bg-surface hover:text-text sm:flex-1"
				style="--motion-delay: 120ms"
				onclick={() => (newCollectionOpen = true)}
				disabled={busy}
			>
				new collection
			</button>
		</div>
		{#if ingestError}
			<p class="mt-3 truncate text-[11px] text-negative" title={ingestError}>
				unsupported RAW file
			</p>
		{/if}

		{#if libraryError}
			<p class="mt-5 truncate text-[11px] text-negative" title={libraryError}>
				couldn't read the local library
			</p>
		{/if}
	</section>
</main>

<DialogShell open={newCollectionOpen} onOpenChange={setCollectionDialogOpen} class="p-5">
	<form onsubmit={createCollection}>
		<DialogHeader
			class="mb-5"
			title="new collection"
			description="group photographs without moving them."
		/>

		<label class="mb-4 block">
			<span class="mb-1.5 block text-[11px] tracking-[0.04em] text-muted">collection name</span>
			<input
				bind:value={collectionName}
				placeholder="untitled collection"
				class="w-full rounded border border-subtle bg-surface px-3 py-2.5 text-xs placeholder:text-muted/50 focus:border-accent focus:outline-none"
			/>
		</label>

		<label
			class="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-muted/45 bg-surface/45 px-6 text-center transition-colors hover:border-accent/70 hover:bg-surface"
			ondragover={(event) => event.preventDefault()}
			ondrop={dropFiles}
		>
			<input
				type="file"
				multiple
				accept={acceptedPhotos}
				disabled={!sourceReady}
				class="sr-only"
				onchange={(event) => chooseFiles(event.currentTarget.files)}
			/>
			{#if files.length > 0}
				<Images size={22} strokeWidth={1.25} class="mb-3 text-accent" />
				<p class="text-xs text-text">
					{files.length} photo{files.length === 1 ? '' : 's'} ready
				</p>
				<p class="mt-1 max-w-xs truncate font-mono text-[11px] text-muted">
					{files
						.slice(0, 3)
						.map((file) => file.name)
						.join(' · ')}
				</p>
			{:else}
				<Upload size={22} strokeWidth={1.25} class="mb-3 text-muted" />
				<p class="text-xs text-text">choose photos or drop them here</p>
				<p class="mt-1 text-[11px] text-muted">local files only</p>
			{/if}
		</label>

		<div class="mt-5 flex justify-end">
			<button
				type="submit"
				disabled={!collectionName.trim() || busy}
				class="cursor-pointer rounded bg-text px-4 py-2 text-[11px] tracking-wide text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
			>
				create collection
			</button>
		</div>
	</form>
</DialogShell>

<StorageManagementDialog
	bind:open={storageOpen}
	status={storageStatus}
	breakdown={storageBreakdown}
	error={storageError}
	{cleanupResult}
	onRefresh={onRefreshStorage}
	{onRequestPersistence}
	{onCleanup}
	{onClearLocalData}
/>
