<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { Github, Images, Upload, X } from '@lucide/svelte';
	import { ACCEPTED_PHOTOS } from '$lib/workspace.svelte';

	interface Props {
		onOpenPhoto: (file: File) => Promise<void>;
		onCreateShoot: (name: string, files: File[]) => Promise<void>;
	}

	let { onOpenPhoto, onCreateShoot }: Props = $props();
	let newShootOpen = $state(false);
	let shootName = $state('');
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

	function chooseFiles(list: FileList | null) {
		if (list) files = [...list];
	}

	function dropFiles(event: DragEvent) {
		event.preventDefault();
		chooseFiles(event.dataTransfer?.files ?? null);
	}

	async function createShoot(event: SubmitEvent) {
		event.preventDefault();
		if (files.length === 0) return;
		busy = true;
		await onCreateShoot(shootName, files);
		busy = false;
		newShootOpen = false;
	}
</script>

<main class="bg-bg text-text flex min-h-svh items-center justify-center px-6">
	<a
		href="https://github.com/twangodev/postframe"
		target="_blank"
		rel="noreferrer"
		aria-label="Postframe on GitHub"
		class="motion-header text-muted hover:bg-surface hover:text-text absolute top-5 right-5 flex size-9 items-center justify-center rounded transition-colors"
	>
		<Github size={17} strokeWidth={1.5} />
	</a>

	<section class="motion-enter w-full max-w-md">
		<h1 class="font-mono text-sm tracking-wide">pf.</h1>
		<p class="text-muted mt-3 text-sm">Post-processing built on your JPEGs.</p>

		<div class="mt-8 flex flex-col gap-2 sm:flex-row">
			<input
				bind:this={openPhotoInput}
				type="file"
				accept={ACCEPTED_PHOTOS}
				class="sr-only"
				onchange={openPhoto}
				disabled={busy}
			/>
			<button
				type="button"
				class="motion-action bg-text text-bg flex h-10 cursor-pointer items-center justify-center rounded px-4 text-xs font-medium hover:opacity-85 sm:flex-1"
				style="--motion-delay: 80ms"
				onclick={() => openPhotoInput.click()}
				disabled={busy}
			>
				Open photo
			</button>

			<button
				type="button"
				class="motion-action border-subtle text-muted hover:bg-surface hover:text-text flex h-10 cursor-pointer items-center justify-center rounded border px-4 text-xs font-medium sm:flex-1"
				style="--motion-delay: 120ms"
				onclick={() => (newShootOpen = true)}
				disabled={busy}
			>
				New shoot
			</button>
		</div>
	</section>
</main>

<Dialog.Root bind:open={newShootOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content
			class="motion-dialog-content border-subtle bg-bg fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl"
		>
			<form onsubmit={createShoot}>
				<div class="mb-5 flex items-start justify-between">
					<div>
						<Dialog.Title class="text-xl font-semibold tracking-tight">New shoot</Dialog.Title>
						<Dialog.Description class="text-muted mt-1 text-sm">
							Name the workspace and choose the photographs to organize.
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
					<span class="text-muted mb-1.5 block font-mono text-[10px] tracking-[0.08em] uppercase"
						>Shoot name</span
					>
					<input
						bind:value={shootName}
						placeholder="Untitled shoot"
						class="border-subtle bg-surface placeholder:text-muted/50 focus:border-accent w-full rounded border px-3 py-2.5 text-sm focus:outline-none"
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
						accept={ACCEPTED_PHOTOS}
						class="sr-only"
						onchange={(event) => chooseFiles(event.currentTarget.files)}
					/>
					{#if files.length > 0}
						<Images size={22} strokeWidth={1.25} class="text-accent mb-3" />
						<p class="text-text text-sm">
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
						<p class="text-text text-sm">Choose photos or drop them here</p>
						<p class="text-muted mt-1 font-mono text-[10px]">Local files only</p>
					{/if}
				</label>

				<div class="mt-5 flex justify-end gap-2">
					<Dialog.Close
						class="border-subtle text-muted hover:text-text cursor-pointer rounded border px-4 py-2 font-mono text-[10px] tracking-wide transition-colors"
					>
						Cancel
					</Dialog.Close>
					<button
						type="submit"
						disabled={files.length === 0 || busy}
						class="bg-text text-bg cursor-pointer rounded px-4 py-2 font-mono text-[10px] tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
					>
						Create shoot
					</button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
