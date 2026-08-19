<script lang="ts">
	import { mergeProps, Tabs } from 'bits-ui';
	import { onMount } from 'svelte';
	import { tinykeys } from 'tinykeys';
	import { Database, Download, Plus, Upload } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import EditorMenuBar from './EditorMenuBar.svelte';
	import SettingsGroupDialog from './SettingsGroupDialog.svelte';
	import StorageManagementDialog from './StorageManagementDialog.svelte';
	import PhotoFileInput from './ui/PhotoFileInput.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import { defaultDevelopSettings } from '$lib/develop-settings';
	import type { EditorMenuAction } from '$lib/editor-menu';
	import { changedGroups } from '$lib/preset';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onExport: () => void;
	}

	let { workspace, onExport }: Props = $props();
	let copyOpen = $state(false);
	let syncOpen = $state(false);
	let importInput = $state<HTMLInputElement>();

	const editedGroups = $derived(
		changedGroups(workspace.selectedPhoto?.edit.adjustments ?? defaultDevelopSettings())
	);
	const syncTargetCount = $derived(workspace.syncTargetIds.length);

	function runMenuAction(action: EditorMenuAction) {
		switch (action) {
			case 'new-collection':
				workspace.requestCollectionCreation();
				break;
			case 'close-library':
				workspace.reset();
				break;
			case 'import-photos':
				importInput?.click();
				break;
			case 'show-organizer':
				workspace.setMode('organize');
				break;
			case 'save-library':
				void workspace.save();
				break;
			case 'export':
				onExport();
				break;
			case 'open-github':
				window.open('https://github.com/twangodev/postframe', '_blank', 'noopener,noreferrer');
				break;
			case 'undo':
				workspace.undo();
				break;
			case 'redo':
				workspace.redo();
				break;
			case 'copy-settings':
				copyOpen = true;
				break;
			case 'paste-settings':
				workspace.pasteSettings();
				break;
			case 'sync-settings':
				if (workspace.canSync) syncOpen = true;
		}
	}

	function shortcut(action: EditorMenuAction) {
		return (event: KeyboardEvent) => {
			event.preventDefault();
			runMenuAction(action);
		};
	}

	function editShortcut(action: EditorMenuAction) {
		return (event: KeyboardEvent) => {
			if (workspace.mode !== 'edit' || editableTarget(event.target)) return;
			event.preventDefault();
			runMenuAction(action);
		};
	}

	function editableTarget(target: EventTarget | null) {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	onMount(() =>
		tinykeys(window, {
			'$mod+n': shortcut('new-collection'),
			'$mod+o': shortcut('import-photos'),
			'$mod+s': shortcut('save-library'),
			'$mod+Shift+e': shortcut('export'),
			'$mod+w': shortcut('close-library'),
			'$mod+z': editShortcut('undo'),
			'$mod+Shift+z': editShortcut('redo'),
			'$mod+y': editShortcut('redo'),
			'$mod+Shift+c': editShortcut('copy-settings'),
			'$mod+Shift+v': editShortcut('paste-settings'),
			'$mod+Shift+s': editShortcut('sync-settings')
		})
	);
</script>

<header class="motion-header shrink-0 border-b border-subtle bg-bg">
	<div class="flex h-12 items-center px-3">
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<Tooltip text="Show photo library">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Show photo library"
						class="flex cursor-pointer items-center gap-1.5 rounded transition-colors hover:text-text"
						onclick={workspace.enterLibrary}
					>
						<img src={postframeLogo} alt="" class="size-5" />
						<span class="text-[12px] font-medium tracking-tight">postframe</span>
					</button>
				{/snippet}
			</Tooltip>
			<span class="h-4 w-px bg-subtle"></span>
			<div class="min-w-0">
				<p class="truncate text-xs font-medium text-text">photo library</p>
				<p
					class:text-negative={workspace.storageStatus === 'error' || !!workspace.ingestError}
					class="text-[11px] tracking-wide text-muted"
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
			<Tabs.List class="flex h-8 items-center rounded border border-subtle bg-surface p-0.5">
				<Tabs.Trigger
					value="organize"
					class="h-6 cursor-pointer rounded-sm px-4 text-[11px] tracking-[0.03em] text-muted transition-colors data-[state=active]:bg-elevated data-[state=active]:text-text"
				>
					organize
				</Tabs.Trigger>
				<Tabs.Trigger
					value="edit"
					disabled={workspace.photos.length === 0}
					class="h-6 cursor-pointer rounded-sm px-4 text-[11px] tracking-[0.03em] text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-30 data-[state=active]:bg-elevated data-[state=active]:text-text"
				>
					edit
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<div class="flex flex-1 items-center justify-end gap-1">
			<Tooltip text="Create collection">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Create collection"
						class="hidden size-7 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-text sm:flex"
						onclick={workspace.requestCollectionCreation}
					>
						<Plus size={14} strokeWidth={1.5} />
					</button>
				{/snippet}
			</Tooltip>
			{#if workspace.localStorageAvailable}
				<StorageManagementDialog {workspace}>
					{#snippet trigger(triggerProps)}
						<Tooltip text="Local storage">
							{#snippet children(props)}
								<button
									{...mergeProps(props, triggerProps)}
									type="button"
									aria-label="Manage local storage"
									class="flex size-7 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-text"
								>
									<Database size={13} strokeWidth={1.5} />
								</button>
							{/snippet}
						</Tooltip>
					{/snippet}
				</StorageManagementDialog>
			{/if}
			<Tooltip text="Import more photos">
				{#snippet children(props)}
					<label
						{...props}
						class="flex size-7 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-text"
					>
						<PhotoFileInput {workspace} bind:element={importInput} />
						<Upload size={14} strokeWidth={1.5} />
					</label>
				{/snippet}
			</Tooltip>
			<button
				type="button"
				class="ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded border border-subtle px-2.5 text-[11px] tracking-wide text-text transition-colors hover:border-muted hover:bg-surface"
				onclick={onExport}
			>
				<Download size={12} strokeWidth={1.5} />
				<span class="hidden sm:inline">export</span>
			</button>
		</div>
	</div>

	{#if workspace.mode === 'edit'}
		<EditorMenuBar
			onAction={runMenuAction}
			canUndo={workspace.canUndo}
			canRedo={workspace.canRedo}
			canPaste={workspace.settingsClipboard !== null}
			canSync={workspace.canSync}
		/>
	{/if}
</header>

<SettingsGroupDialog
	bind:open={copyOpen}
	title="copy settings"
	description="choose which settings of this photograph to copy."
	confirmLabel="copy"
	groups={editedGroups}
	onConfirm={workspace.copySettings}
/>

<SettingsGroupDialog
	bind:open={syncOpen}
	title="sync settings"
	description={`apply the chosen settings of this photograph to the ${syncTargetCount} other selected photo${syncTargetCount === 1 ? '' : 's'}.`}
	confirmLabel="sync"
	groups={editedGroups}
	onConfirm={workspace.syncSettings}
/>
