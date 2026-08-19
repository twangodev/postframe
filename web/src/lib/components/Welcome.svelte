<script lang="ts">
	import { SiGithub } from '@icons-pack/svelte-simple-icons';
	import { X } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import CollectionDialog from './CollectionDialog.svelte';
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

	async function createCollection(name: string, files: File[]) {
		busy = true;
		try {
			await onCreateCollection(name, files);
			newCollectionOpen = false;
		} finally {
			busy = false;
		}
	}

	function collectionDialogClosed(open: boolean) {
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

<CollectionDialog
	bind:open={newCollectionOpen}
	onOpenChange={collectionDialogClosed}
	onCreate={createCollection}
	photos={{ accept: acceptedPhotos, ready: sourceReady }}
/>

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
