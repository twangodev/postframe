<script lang="ts">
	import { ImageDown } from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import ContextMenu from './ui/ContextMenu.svelte';
	import type { MenuEntry } from '$lib/menu';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	type FilmstripMenuAction = 'open' | 'organize';
	const filmstripMenu: MenuEntry<FilmstripMenuAction>[] = [
		{ kind: 'action', label: 'open photo', action: 'open' },
		{ kind: 'action', label: 'show in organizer', action: 'organize' }
	];

	function runFilmstripAction(action: FilmstripMenuAction, photoId: string) {
		if (action === 'open') workspace.selectPhoto(photoId);
		else {
			workspace.setMode('organize');
			workspace.selectPhoto(photoId);
		}
	}
</script>

<section class="motion-panel-up flex h-24 shrink-0 border-t border-subtle bg-bg">
	<div class="flex w-11 shrink-0 items-center justify-center border-r border-subtle text-muted">
		<ImageDown size={13} strokeWidth={1.25} />
	</div>
	<div class="flex min-w-0 flex-1 gap-2 overflow-x-auto p-2">
		{#each workspace.photos as photo, index (photo.id)}
			<ContextMenu
				items={filmstripMenu}
				onAction={(action) => runFilmstripAction(action, photo.id)}
			>
				{#snippet children({ props })}
					<button
						{...props}
						type="button"
						aria-label={photo.name}
						aria-pressed={workspace.selectedIds.includes(photo.id)}
						class="motion-card group relative w-24 shrink-0 cursor-pointer overflow-hidden rounded border bg-canvas {workspace.activePhotoId ===
						photo.id
							? 'border-accent'
							: workspace.selectedIds.includes(photo.id)
								? 'border-text/70 ring-1 ring-text/40'
								: 'border-subtle hover:border-muted'}"
						style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
						onclick={(event) => workspace.selectPhoto(photo.id, event.metaKey || event.ctrlKey)}
					>
						<PhotoVisual {photo} onRequest={workspace.loadThumbnail} />
						<span
							class="absolute top-1 left-1 rounded-sm bg-black/65 px-1 font-mono text-[11px] text-white"
							>{index + 1}</span
						>
						<span
							class="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 font-mono text-[11px] text-white/80"
							>{photo.name}</span
						>
					</button>
				{/snippet}
			</ContextMenu>
		{/each}
	</div>
</section>
