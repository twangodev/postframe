<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { onMount } from 'svelte';
	import { tinykeys } from 'tinykeys';
	import { Download, Plus, Upload } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import EditorMenuBar from './EditorMenuBar.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import type { EditorMenuAction } from '$lib/editor-menu';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onImport: (files: File[]) => Promise<void>;
		onExport: () => void;
	}

	let { workspace, onImport, onExport }: Props = $props();
	let importing = $state(false);
	let importInput: HTMLInputElement;

	async function importFiles(list: FileList | null) {
		if (!list?.length) return;
		importing = true;
		await onImport([...list]);
		importing = false;
	}

	function runMenuAction(action: EditorMenuAction) {
		switch (action) {
			case 'new-collection':
			case 'close-collection':
				workspace.reset();
				break;
			case 'import-photos':
				importInput.click();
				break;
			case 'show-organizer':
				workspace.setMode('organize');
				break;
			case 'save-collection':
				void workspace.save();
				break;
			case 'export':
				onExport();
				break;
			case 'open-github':
				window.open('https://github.com/twangodev/postframe', '_blank', 'noopener,noreferrer');
		}
	}

	function shortcut(action: EditorMenuAction) {
		return (event: KeyboardEvent) => {
			event.preventDefault();
			runMenuAction(action);
		};
	}

	onMount(() =>
		tinykeys(window, {
			'$mod+n': shortcut('new-collection'),
			'$mod+o': shortcut('import-photos'),
			'$mod+s': shortcut('save-collection'),
			'$mod+Shift+e': shortcut('export'),
			'$mod+w': shortcut('close-collection')
		})
	);
</script>

<header class="motion-header border-subtle bg-bg shrink-0 border-b">
	<div class="flex h-12 items-center px-3">
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<Tooltip text="Close this workspace">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Close this workspace"
						class="hover:text-text flex cursor-pointer items-center gap-1.5 rounded transition-colors"
						onclick={workspace.reset}
					>
						<img src={postframeLogo} alt="" class="size-5" />
						<span class="text-[11px] font-medium tracking-tight">postframe</span>
					</button>
				{/snippet}
			</Tooltip>
			<span class="bg-subtle h-4 w-px"></span>
			<div class="min-w-0">
				<p class="text-text truncate text-xs font-medium">{workspace.collectionName}</p>
				<p
					class:text-negative={workspace.storageStatus === 'error' || !!workspace.ingestError}
					class="text-muted text-[10px] tracking-wide"
					title={workspace.ingestError ?? workspace.storageError ?? undefined}
				>
					{workspace.photos.length} photo{workspace.photos.length === 1 ? '' : 's'} ·
					{workspace.ingestError
						? 'import rejected'
						: workspace.storageStatus === 'saving'
							? 'saving'
							: workspace.storageStatus === 'saved'
								? 'saved locally'
								: workspace.storageStatus === 'error'
									? 'save failed'
									: 'memory only'}
				</p>
			</div>
		</div>

		<Tabs.Root
			value={workspace.mode}
			onValueChange={(value) => workspace.setMode(value as 'organize' | 'edit')}
			class="absolute left-1/2 -translate-x-1/2"
		>
			<Tabs.List class="border-subtle bg-surface flex h-8 items-center rounded border p-0.5">
				<Tabs.Trigger
					value="organize"
					class="text-muted data-[state=active]:bg-elevated data-[state=active]:text-text h-6 cursor-pointer rounded-sm px-4 text-[10px] tracking-[0.03em] transition-colors"
				>
					organize
				</Tabs.Trigger>
				<Tabs.Trigger
					value="edit"
					disabled={workspace.photos.length === 0}
					class="text-muted data-[state=active]:bg-elevated data-[state=active]:text-text h-6 cursor-pointer rounded-sm px-4 text-[10px] tracking-[0.03em] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
				>
					edit
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<div class="flex flex-1 items-center justify-end gap-1">
			<Tooltip text="Create another collection">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Create another collection"
						class="text-muted hover:bg-surface hover:text-text hidden size-7 cursor-pointer items-center justify-center rounded transition-colors sm:flex"
						onclick={workspace.reset}
					>
						<Plus size={14} strokeWidth={1.5} />
					</button>
				{/snippet}
			</Tooltip>
			<Tooltip text="Import more photos">
				{#snippet children(props)}
					<label
						{...props}
						class="text-muted hover:bg-surface hover:text-text flex size-7 cursor-pointer items-center justify-center rounded transition-colors"
					>
						<input
							bind:this={importInput}
							type="file"
							multiple
							accept={workspace.acceptedPhotos}
							class="sr-only"
							disabled={importing}
							onchange={(event) => importFiles(event.currentTarget.files)}
						/>
						<Upload size={14} strokeWidth={1.5} />
					</label>
				{/snippet}
			</Tooltip>
			<button
				type="button"
				class="border-subtle text-text hover:border-muted hover:bg-surface ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2.5 text-[10px] tracking-wide transition-colors"
				onclick={onExport}
			>
				<Download size={12} strokeWidth={1.5} />
				<span class="hidden sm:inline">export</span>
			</button>
		</div>
	</div>

	{#if workspace.mode === 'edit'}
		<EditorMenuBar onAction={runMenuAction} />
	{/if}
</header>
