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

<section class="motion-panel-up border-subtle bg-bg flex h-24 shrink-0 border-t">
	<div class="border-subtle text-muted flex w-11 shrink-0 items-center justify-center border-r">
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
						class="motion-card group bg-canvas relative w-24 shrink-0 cursor-pointer overflow-hidden rounded border {workspace.activePhotoId ===
						photo.id
							? 'border-accent'
							: 'border-subtle hover:border-muted'}"
						style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
						onclick={() => workspace.selectPhoto(photo.id)}
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
