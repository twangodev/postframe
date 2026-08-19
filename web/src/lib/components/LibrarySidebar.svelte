<script lang="ts">
	import { Clock3, Flag, Folder, FolderPlus, Image } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import IconButton from './ui/IconButton.svelte';
	import { sameSource, type LibrarySource, type LibrarySourceCounts } from '$lib/library-view';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		source: LibrarySource;
		counts: LibrarySourceCounts;
	}

	let { workspace, source = $bindable(), counts }: Props = $props();
</script>

{#snippet navRow(
	value: LibrarySource,
	Icon: Component<Record<string, unknown>>,
	label: string,
	count: number
)}
	<button
		type="button"
		class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {sameSource(
			source,
			value
		)
			? 'bg-surface text-text'
			: 'text-muted hover:bg-surface/60 hover:text-text'}"
		onclick={() => (source = value)}
	>
		<Icon size={13} strokeWidth={1.5} />
		<span class="min-w-0 flex-1 truncate">{label}</span>
		<span class="font-mono text-[11px]">{count}</span>
	</button>
{/snippet}

<aside class="motion-panel-left min-h-0 overflow-y-auto border-r border-subtle bg-bg py-3">
	<div class="px-3 pb-2 text-[11px] tracking-[0.04em] text-muted">library</div>
	<nav class="space-y-0.5 px-2" aria-label="Library">
		{@render navRow({ kind: 'all' }, Image, 'all photos', counts.all)}
		{@render navRow({ kind: 'recent' }, Clock3, 'recent', counts.recent)}
		{@render navRow({ kind: 'favorites' }, Flag, 'favorites', counts.favorites)}
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
			{@render navRow(
				{ kind: 'collection', collectionId: collection.id },
				Folder,
				collection.name,
				collection.photoIds.length
			)}
		{/each}
		{#if workspace.collections.length === 0}
			<p class="px-2 py-2 text-[11px] leading-relaxed text-muted/65">no collections yet.</p>
		{/if}
	</div>
</aside>
