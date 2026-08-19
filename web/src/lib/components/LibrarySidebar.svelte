<script lang="ts">
	import { Clock3, Flag, Folder, FolderPlus, Image } from '@lucide/svelte';
	import IconButton from './ui/IconButton.svelte';
	import SelectableRow from './ui/SelectableRow.svelte';
	import { sameSource, type LibrarySource, type LibrarySourceCounts } from '$lib/library-view';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		source: LibrarySource;
		counts: LibrarySourceCounts;
	}

	let { workspace, source = $bindable(), counts }: Props = $props();

	const librarySources = $derived([
		{
			value: { kind: 'all' } as LibrarySource,
			icon: Image,
			label: 'all photos',
			count: counts.all
		},
		{
			value: { kind: 'recent' } as LibrarySource,
			icon: Clock3,
			label: 'recent',
			count: counts.recent
		},
		{
			value: { kind: 'favorites' } as LibrarySource,
			icon: Flag,
			label: 'favorites',
			count: counts.favorites
		}
	]);
</script>

<aside class="motion-panel-left min-h-0 overflow-y-auto border-r border-subtle bg-bg py-3">
	<div class="px-3 pb-2 text-[11px] tracking-[0.04em] text-muted">library</div>
	<nav class="space-y-0.5 px-2" aria-label="Library">
		{#each librarySources as { value, icon, label, count } (label)}
			<SelectableRow
				selected={sameSource(source, value)}
				{icon}
				meta={`${count}`}
				onclick={() => (source = value)}
			>
				{label}
			</SelectableRow>
		{/each}
	</nav>

	<div class="mx-3 my-3 h-px bg-subtle"></div>
	<div class="flex items-center justify-between px-3 pb-2">
		<span class="text-[11px] tracking-[0.04em] text-muted">collections</span>
		<IconButton label="Create collection" tooltip onclick={workspace.requestCollectionCreation}>
			<FolderPlus size={13} strokeWidth={1.5} />
		</IconButton>
	</div>
	<div class="space-y-0.5 px-2">
		{#each workspace.collections as collection (collection.id)}
			<SelectableRow
				selected={sameSource(source, { kind: 'collection', collectionId: collection.id })}
				icon={Folder}
				meta={`${collection.photoIds.length}`}
				onclick={() => (source = { kind: 'collection', collectionId: collection.id })}
			>
				{collection.name}
			</SelectableRow>
		{/each}
		{#if workspace.collections.length === 0}
			<p class="px-2 py-2 text-[11px] leading-relaxed text-muted/65">no collections yet.</p>
		{/if}
	</div>
</aside>
