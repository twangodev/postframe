<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { SiGithub } from '@icons-pack/svelte-simple-icons';
	import { Images, Upload, X } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';
	import StorageManagementDialog from './StorageManagementDialog.svelte';
	import type { BrowserStorageStatus } from '$lib/browser-storage';
	import type { CollectionSummary } from '$lib/collection-store';

	interface Props {
		acceptedPhotos: string;
		sourceReady: boolean;
		ingestError: string | null;
		recentCollections: CollectionSummary[];
		catalogReady: boolean;
		catalogError: string | null;
		localStorageAvailable: boolean;
		storageStatus: BrowserStorageStatus | null;
		storageError: string | null;
		onOpenPhoto: (file: File) => Promise<void>;
		onCreateCollection: (name: string, files: File[]) => Promise<void>;
		onOpenCollection: (collectionId: string) => Promise<void>;
		onClearLocalData: () => Promise<void>;
		onRefreshStorage: () => Promise<void>;
		onRequestPersistence: () => Promise<void>;
	}

	let {
		acceptedPhotos,
		sourceReady,
		ingestError,
		recentCollections,
		catalogReady,
		catalogError,
		localStorageAvailable,
		storageStatus,
		storageError,
		onOpenPhoto,
		onCreateCollection,
		onOpenCollection,
		onClearLocalData,
		onRefreshStorage,
		onRequestPersistence
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
		await onOpenPhoto(file);
		busy = false;
	}

	async function openCollection(collectionId: string) {
		if (busy) return;
		busy = true;
		await onOpenCollection(collectionId);
		busy = false;
	}

	function collectionDate(timestamp: number) {
		return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(timestamp);
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
		if (files.length === 0) return;
		busy = true;
		await onCreateCollection(collectionName, files);
		busy = false;
	}

	async function closeCollectionSetup() {
		if (!newCollectionOpen || busy) return;
		newCollectionOpen = false;
		await openEmptyCollection(collectionName);
	}

	async function openEmptyCollection(name = '') {
		if (busy) return;
		busy = true;
		await onCreateCollection(name, []);
		busy = false;
	}

	function setCollectionDialogOpen(open: boolean) {
		if (open) newCollectionOpen = true;
		else void closeCollectionSetup();
	}
</script>

<main class="bg-bg text-text flex min-h-svh items-center justify-center px-6">
	<button
		type="button"
		aria-label="Continue with an empty collection"
		title="Continue with an empty collection"
		class="motion-header text-muted hover:bg-surface hover:text-text absolute top-5 right-5 flex size-9 items-center justify-center rounded transition-colors"
		onclick={() => openEmptyCollection()}
		disabled={busy}
	>
		<X size={17} strokeWidth={1.5} />
	</button>

	<a
		href="https://github.com/twangodev/postframe"
		target="_blank"
		rel="noreferrer"
		aria-label="Postframe on GitHub"
		class="motion-enter text-muted/70 hover:bg-surface hover:text-text absolute right-5 bottom-5 flex size-9 items-center justify-center rounded transition-colors"
	>
		<SiGithub size={15} aria-hidden="true" />
	</a>

	{#if localStorageAvailable}
		<button
			type="button"
			class="motion-enter text-muted/70 hover:bg-surface hover:text-text absolute bottom-5 left-5 rounded px-2.5 py-2 text-[10px] transition-colors"
			onclick={openStorage}
		>
			local storage
		</button>
	{/if}

	<section class="motion-enter w-full max-w-md">
		<div class="flex items-center gap-2">
			<img src={postframeLogo} alt="" class="size-7" />
			<span class="text-[13px] font-medium tracking-tight">postframe</span>
		</div>
		<p class="text-muted mt-3 text-[13px]">post-processing built on your JPEGs.</p>

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
				class="motion-action bg-text text-bg flex h-9 cursor-pointer items-center justify-center rounded px-4 text-xs font-medium hover:opacity-85 sm:flex-1"
				style="--motion-delay: 80ms"
				onclick={() => openPhotoInput.click()}
				disabled={busy || !sourceReady}
			>
				open photo
			</button>

			<button
				type="button"
				class="motion-action border-subtle text-muted hover:bg-surface hover:text-text flex h-9 cursor-pointer items-center justify-center rounded border px-4 text-xs font-medium sm:flex-1"
				style="--motion-delay: 120ms"
				onclick={() => (newCollectionOpen = true)}
				disabled={busy}
			>
				new collection
			</button>
		</div>
		{#if ingestError}
			<p class="text-negative mt-3 truncate text-[10px]" title={ingestError}>
				unsupported RAW file
			</p>
		{/if}

		{#if catalogReady && recentCollections.length > 0}
			<div class="motion-enter border-subtle mt-9 border-t pt-4">
				<p class="text-muted mb-1.5 text-[10px] tracking-[0.04em]">recent</p>
				<div class="flex flex-col gap-0.5">
					{#each recentCollections.slice(0, 5) as collection, index (collection.id)}
						<button
							type="button"
							class="motion-card hover:bg-surface flex min-w-0 cursor-pointer items-center justify-between rounded px-2 py-2 text-left disabled:cursor-wait disabled:opacity-45"
							style={`--motion-delay: ${160 + index * 30}ms`}
							disabled={busy}
							onclick={() => openCollection(collection.id)}
						>
							<span class="truncate text-[11px] font-medium">{collection.name}</span>
							<span class="text-muted ml-4 shrink-0 font-mono text-[9px]">
								{collection.photoCount} · {collectionDate(collection.updatedAt)}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{:else if catalogError}
			<p class="text-negative mt-5 truncate text-[10px]" title={catalogError}>
				couldn't read local collections
			</p>
		{/if}
	</section>
</main>

<Dialog.Root open={newCollectionOpen} onOpenChange={setCollectionDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
		<CenteredDialogContent class="p-5">
			<form onsubmit={createCollection}>
				<div class="mb-5 flex items-start justify-between">
					<div>
						<Dialog.Title class="text-sm font-medium tracking-tight">new collection</Dialog.Title>
						<Dialog.Description class="text-muted mt-1 text-xs">
							name the workspace and choose photographs.
						</Dialog.Description>
					</div>
					<Dialog.Close
						aria-label="Close"
						class="text-muted hover:text-text cursor-pointer rounded p-1 transition-colors"
					>
						<X size={16} />
					</Dialog.Close>
				</div>

				<label class="mb-4 block">
					<span class="text-muted mb-1.5 block text-[10px] tracking-[0.04em]">collection name</span>
					<input
						bind:value={collectionName}
						placeholder="untitled collection"
						class="border-subtle bg-surface placeholder:text-muted/50 focus:border-accent w-full rounded border px-3 py-2.5 text-xs focus:outline-none"
					/>
				</label>

				<label
					class="border-muted/45 bg-surface/45 hover:border-accent/70 hover:bg-surface flex min-h-44 cursor-pointer flex-col items-center justify-center rounded border border-dashed px-6 text-center transition-colors"
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
						<Images size={22} strokeWidth={1.25} class="text-accent mb-3" />
						<p class="text-text text-xs">
							{files.length} photo{files.length === 1 ? '' : 's'} ready
						</p>
						<p class="text-muted mt-1 max-w-xs truncate font-mono text-[10px]">
							{files
								.slice(0, 3)
								.map((file) => file.name)
								.join(' · ')}
						</p>
					{:else}
						<Upload size={22} strokeWidth={1.25} class="text-muted mb-3" />
						<p class="text-text text-xs">choose photos or drop them here</p>
						<p class="text-muted mt-1 text-[10px]">local files only</p>
					{/if}
				</label>

				<div class="mt-5 flex justify-end">
					<button
						type="submit"
						disabled={files.length === 0 || busy}
						class="bg-text text-bg cursor-pointer rounded px-4 py-2 text-[10px] tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
					>
						create collection
					</button>
				</div>
			</form>
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>

<StorageManagementDialog
	bind:open={storageOpen}
	status={storageStatus}
	error={storageError}
	onRefresh={onRefreshStorage}
	{onRequestPersistence}
	{onClearLocalData}
/>
