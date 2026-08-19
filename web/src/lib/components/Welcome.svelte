<script lang="ts">
	import { SiGithub } from '@icons-pack/svelte-simple-icons';
	import { X } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import CollectionDialog from './CollectionDialog.svelte';
	import IconButton from './ui/IconButton.svelte';
	import StorageManagementDialog from './StorageManagementDialog.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		acceptedPhotos: string;
		sourceReady: boolean;
		ingestError: string | null;
		libraryError: string | null;
		onOpenPhoto: (file: File) => Promise<void>;
		onCreateCollection: (name: string, files: File[]) => Promise<void>;
		onEnterLibrary: () => void;
	}

	let {
		workspace,
		acceptedPhotos,
		sourceReady,
		ingestError,
		libraryError,
		onOpenPhoto,
		onCreateCollection,
		onEnterLibrary
	}: Props = $props();
	let newCollectionOpen = $state(false);
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
	<IconButton
		label="Enter photo library"
		tooltip
		size={9}
		class="motion-header absolute top-5 right-5"
		onclick={onEnterLibrary}
		disabled={busy}
	>
		<X size={17} strokeWidth={1.5} />
	</IconButton>

	<a
		href="https://github.com/twangodev/postframe"
		target="_blank"
		rel="noreferrer"
		aria-label="Postframe on GitHub"
		class="motion-enter absolute right-5 bottom-5 flex size-9 items-center justify-center rounded text-muted/70 transition-colors hover:bg-surface hover:text-text"
	>
		<SiGithub size={15} aria-hidden="true" />
	</a>

	{#if workspace.localStorageAvailable}
		<StorageManagementDialog {workspace}>
			{#snippet trigger(props)}
				<button
					{...props}
					type="button"
					class="motion-enter absolute bottom-5 left-5 rounded px-2.5 py-2 text-[11px] text-muted/70 transition-colors hover:bg-surface hover:text-text"
				>
					local storage
				</button>
			{/snippet}
		</StorageManagementDialog>
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
