<script lang="ts">
	import { Flag, Layers3 } from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import ContextMenu from './ui/ContextMenu.svelte';
	import RatingStars from './ui/RatingStars.svelte';
	import type { LibraryView } from '$lib/library-view';
	import type { MenuEntry } from '$lib/menu';
	import { labelColors } from '$lib/photo-format';
	import type { PhotoMenuAction } from '$lib/photo-menu';
	import {
		formatBytes,
		type Photo,
		type PhotoStack,
		type WorkspaceState
	} from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		photo: Photo;
		view: LibraryView;
		index: number;
		stack: PhotoStack | undefined;
		menu: MenuEntry<PhotoMenuAction>[];
		onMenuOpen: () => void;
		onMenuAction: (action: PhotoMenuAction) => void;
	}

	let { workspace, photo, view, index, stack, menu, onMenuOpen, onMenuAction }: Props = $props();
</script>

<ContextMenu items={menu} onOpen={onMenuOpen} onAction={onMenuAction}>
	{#snippet children({ props })}
		<div
			{...props}
			role="button"
			tabindex="0"
			aria-label={`Select ${photo.name}`}
			class={view === 'grid'
				? `motion-card group min-w-0 cursor-pointer rounded border bg-bg p-1.5 ${workspace.selectedIds.includes(photo.id) ? 'border-accent' : 'border-subtle hover:border-muted'}`
				: `motion-card group grid h-14 cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)_5rem_5rem] items-center gap-3 bg-bg px-2 ${workspace.selectedIds.includes(photo.id) ? 'bg-surface' : 'hover:bg-surface/65'}`}
			style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
			onclick={(event) => workspace.selectPhoto(photo.id, event.metaKey || event.ctrlKey)}
			ondblclick={() => workspace.editPhoto(photo.id)}
			onkeydown={(event) => event.key === 'Enter' && workspace.editPhoto(photo.id)}
		>
			<div
				class={view === 'grid'
					? 'relative aspect-[4/3] overflow-hidden rounded-sm bg-surface'
					: 'relative h-11 overflow-hidden rounded-sm bg-surface'}
			>
				<PhotoVisual {photo} onRequest={workspace.loadThumbnail} />
				{#if stack}
					<button
						type="button"
						aria-label={stack.collapsed ? 'Expand stack' : 'Collapse stack'}
						class="absolute right-1 bottom-1 flex h-5 cursor-pointer items-center gap-1 rounded-sm bg-black/65 px-1.5 font-mono text-[11px] text-white backdrop-blur"
						onclick={(event) => {
							event.stopPropagation();
							workspace.toggleStack(stack.id);
						}}
					>
						<Layers3 size={9} />
						{stack.photoIds.length}
					</button>
				{/if}
				{#if photo.flagged}
					<Flag size={11} class="absolute top-1 left-1 fill-white text-white drop-shadow" />
				{/if}
			</div>

			<div class={view === 'grid' ? 'min-w-0 px-0.5 pt-2 pb-0.5' : 'min-w-0'}>
				<p class="truncate font-mono text-[11px] text-text">{photo.name}</p>
				{#if view === 'grid'}
					<div class="mt-1.5 flex items-center justify-between">
						<RatingStars
							rating={photo.rating}
							size={10}
							class="text-muted/55"
							onRate={(rating) => workspace.setRating(photo.id, rating)}
						/>
						<span
							class="size-1.5 rounded-full"
							style:background={labelColors[photo.colorLabel]}
							style:opacity={photo.colorLabel === 'none' ? 0.3 : 1}
						></span>
					</div>
				{/if}
			</div>
			{#if view === 'list'}
				<span class="font-mono text-[11px] text-muted">{photo.extension}</span>
				<span class="font-mono text-[11px] text-muted">{formatBytes(photo.size)}</span>
			{/if}
		</div>
	{/snippet}
</ContextMenu>
