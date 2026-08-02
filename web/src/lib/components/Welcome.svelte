<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { SiGithub } from '@icons-pack/svelte-simple-icons';
	import { Images, Upload, X } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';
	import StorageManagementDialog from './StorageManagementDialog.svelte';
	import type { BrowserStorageStatus } from '$lib/browser-storage';
	import type { CleanupResult } from '$lib/library-service';

	interface Props {
		acceptedPhotos: string;
		sourceReady: boolean;
		ingestError: string | null;
		libraryError: string | null;
		localStorageAvailable: boolean;
		storageStatus: BrowserStorageStatus | null;
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

<main class="bg-bg text-text flex min-h-svh items-center justify-center px-6">
	<button
		type="button"
		aria-label="Enter photo library"
		title="Enter photo library"
		class="motion-header text-muted hover:bg-surface hover:text-text absolute top-5 right-5 flex size-9 items-center justify-center rounded transition-colors"
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

		{#if libraryError}
			<p class="text-negative mt-5 truncate text-[10px]" title={libraryError}>
				couldn't read the local library
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
							group photographs without moving them.
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
						disabled={!collectionName.trim() || busy}
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
	{cleanupResult}
	onRefresh={onRefreshStorage}
	{onRequestPersistence}
	{onCleanup}
	{onClearLocalData}
/>
