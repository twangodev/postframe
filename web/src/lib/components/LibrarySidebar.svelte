<script lang="ts">
	import { Clock3, Flag, Folder, FolderPlus, Image } from '@lucide/svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import { sameSource, type LibrarySource, type LibrarySourceCounts } from '$lib/library-view';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		source: LibrarySource;
		counts: LibrarySourceCounts;
	}

	let { workspace, source = $bindable(), counts }: Props = $props();
</script>

<aside class="motion-panel-left min-h-0 overflow-y-auto border-r border-subtle bg-bg py-3">
	<div class="px-3 pb-2 text-[11px] tracking-[0.04em] text-muted">library</div>
	<nav class="space-y-0.5 px-2" aria-label="Library">
		<button
			type="button"
			class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {sameSource(
				source,
				{ kind: 'all' }
			)
				? 'bg-surface text-text'
				: 'text-muted hover:bg-surface/60 hover:text-text'}"
			onclick={() => (source = { kind: 'all' })}
		>
			<Image size={13} strokeWidth={1.5} />
			<span class="flex-1">all photos</span>
			<span class="font-mono text-[11px]">{counts.all}</span>
		</button>
		<button
			type="button"
			class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {sameSource(
				source,
				{ kind: 'recent' }
			)
				? 'bg-surface text-text'
				: 'text-muted hover:bg-surface/60 hover:text-text'}"
			onclick={() => (source = { kind: 'recent' })}
		>
			<Clock3 size={13} strokeWidth={1.5} />
			<span class="flex-1">recent</span>
			<span class="font-mono text-[11px]">{counts.recent}</span>
		</button>
		<button
			type="button"
			class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {sameSource(
				source,
				{ kind: 'favorites' }
			)
				? 'bg-surface text-text'
				: 'text-muted hover:bg-surface/60 hover:text-text'}"
			onclick={() => (source = { kind: 'favorites' })}
		>
			<Flag size={13} strokeWidth={1.5} />
			<span class="flex-1">favorites</span>
			<span class="font-mono text-[11px]">{counts.favorites}</span>
		</button>
	</nav>

	<div class="mx-3 my-3 h-px bg-subtle"></div>
	<div class="flex items-center justify-between px-3 pb-2">
		<span class="text-[11px] tracking-[0.04em] text-muted">collections</span>
		<Tooltip text="Create collection">
			{#snippet children(props)}
				<button
					{...props}
					type="button"
					aria-label="Create collection"
					class="cursor-pointer rounded text-muted transition-colors hover:text-text"
					onclick={workspace.requestCollectionCreation}
				>
					<FolderPlus size={13} strokeWidth={1.5} />
				</button>
			{/snippet}
		</Tooltip>
	</div>
	<div class="space-y-0.5 px-2">
		{#each workspace.collections as collection (collection.id)}
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {sameSource(
					source,
					{ kind: 'collection', collectionId: collection.id }
				)
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = { kind: 'collection', collectionId: collection.id })}
			>
				<Folder size={13} strokeWidth={1.5} />
				<span class="min-w-0 flex-1 truncate">{collection.name}</span>
				<span class="font-mono text-[11px]">{collection.photoIds.length}</span>
			</button>
		{/each}
		{#if workspace.collections.length === 0}
			<p class="px-2 py-2 text-[11px] leading-relaxed text-muted/65">no collections yet.</p>
		{/if}
	</div>
</aside>
