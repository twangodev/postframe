<script lang="ts">
	import { ToggleGroup } from 'bits-ui';
	import { Box, Grid2X2, ImagePlus, Layers3, List, Search, Ungroup } from '@lucide/svelte';
	import CollectionDialog from './CollectionDialog.svelte';
	import LibrarySidebar from './LibrarySidebar.svelte';
	import PhotoCard from './PhotoCard.svelte';
	import PhotoDetailRail from './PhotoDetailRail.svelte';
	import PhotoFileInput from './ui/PhotoFileInput.svelte';
	import RemovePhotosDialog from './RemovePhotosDialog.svelte';
	import { contextTargets, photoMenu, type PhotoMenuAction } from '$lib/photo-menu';
	import { type Photo, type WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
	let search = $state('');
	let view = $state('grid');
	let source = $state('all');
	let sort = $state('capture');
	let removalIds = $state<string[] | null>(null);
	const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

	const selectedStack = $derived(
		workspace.stacks.find((stack) =>
			workspace.selectedIds.some((id) => stack.photoIds.includes(id))
		)
	);
	const recentCount = $derived(
		workspace.photos.filter((photo) => photo.importedAt >= recentCutoff).length
	);
	const visiblePhotos = $derived.by(() => {
		const query = search.trim().toLowerCase();
		const collection = source.startsWith('collection:')
			? workspace.collections.find((candidate) => candidate.id === source.slice(11))
			: null;
		let photos = workspace.photos.filter((photo) => {
			if (query && !photo.name.toLowerCase().includes(query)) return false;
			if (source === 'recent' && photo.importedAt < recentCutoff) return false;
			if (source === 'favorites' && !photo.flagged) return false;
			if (collection && !collection.photoIds.includes(photo.id)) return false;
			return true;
		});

		const filteredIds = new Set(photos.map((photo) => photo.id));
		photos = photos.filter((photo) => {
			if (!photo.stackId) return true;
			const stack = workspace.stacks.find((candidate) => candidate.id === photo.stackId);
			const firstVisible = stack?.photoIds.find((photoId) => filteredIds.has(photoId));
			return !stack?.collapsed || firstVisible === photo.id;
		});

		return [...photos].sort((a, b) => {
			if (sort === 'name') return a.name.localeCompare(b.name);
			if (sort === 'rating') return b.rating - a.rating;
			return a.captured.localeCompare(b.captured);
		});
	});

	function stackFor(photo: Photo) {
		return workspace.stacks.find((stack) => stack.id === photo.stackId);
	}

	function menuTargets(photo: Photo) {
		const { targetIds } = contextTargets(photo.id, workspace.selectedIds);
		return workspace.photos.filter(({ id }) => targetIds.includes(id));
	}

	function cardMenu(photo: Photo) {
		const targets = menuTargets(photo);
		const stackId = targets[0]?.stackId ?? null;
		const stack =
			stackId && targets.every((target) => target.stackId === stackId)
				? (workspace.stacks.find(({ id }) => id === stackId) ?? null)
				: null;
		return photoMenu({ targets, stack, collections: workspace.collections });
	}

	function openCardMenu(photo: Photo) {
		if (contextTargets(photo.id, workspace.selectedIds).moveSelection) {
			workspace.selectPhoto(photo.id);
		}
	}

	function runPhotoAction(action: PhotoMenuAction, photo: Photo) {
		const { targetIds } = contextTargets(photo.id, workspace.selectedIds);
		switch (action.type) {
			case 'edit':
				workspace.editPhoto(photo.id);
				break;
			case 'flag':
				workspace.applyFlag(targetIds, action.flagged);
				break;
			case 'rate':
				workspace.applyRating(targetIds, action.rating);
				break;
			case 'label':
				workspace.applyColorLabel(targetIds, action.label);
				break;
			case 'collection':
				workspace.applyCollectionMembership(targetIds, action.collectionId, action.member);
				break;
			case 'create-collection':
				workspace.requestCollectionCreation();
				break;
			case 'group-stack':
				workspace.createStack();
				break;
			case 'ungroup-stack':
				workspace.ungroupStack(action.stackId);
				break;
			case 'remove':
				removalIds = targetIds;
		}
	}

	function confirmRemoval() {
		if (removalIds) workspace.deletePhotos(removalIds);
		removalIds = null;
	}
</script>

<div
	class={workspace.photos.length === 0
		? 'grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] bg-bg max-[1080px]:grid-cols-[11rem_minmax(0,1fr)]'
		: 'grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_16rem] bg-bg max-[1080px]:grid-cols-[11rem_minmax(0,1fr)_14rem]'}
>
	<LibrarySidebar {workspace} bind:source {recentCount} />

	<section class="motion-panel-up flex min-h-0 min-w-0 flex-col bg-canvas">
		{#if workspace.photos.length > 0}
			<div class="flex h-11 shrink-0 items-center gap-2 border-b border-subtle bg-bg px-3">
				<label class="relative max-w-72 min-w-32 flex-1">
					<Search
						size={13}
						strokeWidth={1.5}
						class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted"
					/>
					<input
						bind:value={search}
						placeholder="search photos"
						class="h-7 w-full rounded border border-subtle bg-surface pr-2 pl-7 text-[11px] text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
					/>
				</label>

				<select
					bind:value={sort}
					aria-label="Sort photos"
					class="h-7 cursor-pointer rounded border border-subtle bg-surface px-2 text-[11px] text-muted focus:border-accent focus:outline-none"
				>
					<option value="capture">capture time</option>
					<option value="name">filename</option>
					<option value="rating">rating</option>
				</select>

				<div class="ml-auto flex items-center gap-1">
					{#if selectedStack}
						<button
							type="button"
							class="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-subtle px-2 text-[11px] text-muted transition-colors hover:text-text"
							onclick={() => workspace.ungroupStack(selectedStack.id)}
						>
							<Ungroup size={12} /> ungroup
						</button>
					{:else}
						<button
							type="button"
							disabled={workspace.selectedIds.length < 2}
							class="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-subtle px-2 text-[11px] text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
							onclick={workspace.createStack}
						>
							<Layers3 size={12} /> group stack
						</button>
					{/if}

					<ToggleGroup.Root
						type="single"
						value={view}
						onValueChange={(value) => value && (view = value)}
						class="flex h-7 rounded border border-subtle bg-surface p-0.5"
					>
						<ToggleGroup.Item
							value="grid"
							aria-label="Grid view"
							class="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted data-[state=on]:bg-elevated data-[state=on]:text-text"
						>
							<Grid2X2 size={12} />
						</ToggleGroup.Item>
						<ToggleGroup.Item
							value="list"
							aria-label="List view"
							class="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted data-[state=on]:bg-elevated data-[state=on]:text-text"
						>
							<List size={12} />
						</ToggleGroup.Item>
					</ToggleGroup.Root>
				</div>
			</div>
		{/if}

		<div class="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
			{#if workspace.photos.length === 0}
				<div class="motion-enter flex h-full flex-col items-center justify-center text-center">
					<div
						class="mb-4 flex size-10 items-center justify-center rounded border border-subtle bg-surface text-muted"
					>
						<ImagePlus size={17} strokeWidth={1.25} />
					</div>
					<p class="text-xs font-medium text-text">empty library</p>
					<p class="mt-1 text-[11px] text-muted">add photographs when you're ready.</p>
					<label
						class="mt-4 flex h-8 cursor-pointer items-center rounded bg-text px-3 text-[11px] font-medium text-bg hover:opacity-85"
					>
						<PhotoFileInput {workspace} />
						import photos
					</label>
				</div>
			{:else if visiblePhotos.length > 0}
				<div
					class={view === 'grid'
						? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3'
						: 'flex flex-col gap-px overflow-hidden rounded border border-subtle bg-subtle'}
				>
					{#each visiblePhotos as photo, index (photo.id)}
						<PhotoCard
							{workspace}
							{photo}
							{view}
							{index}
							stack={stackFor(photo)}
							menu={cardMenu(photo)}
							onMenuOpen={() => openCardMenu(photo)}
							onMenuAction={(action) => runPhotoAction(action, photo)}
						/>
					{/each}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-center">
					<Box size={28} strokeWidth={1} class="mb-3 text-muted" />
					<p class="text-xs text-text">no photos in this view</p>
					<p class="mt-1 text-[11px] text-muted">try another collection or clear the search.</p>
				</div>
			{/if}
		</div>

		{#if workspace.photos.length > 0}
			<footer
				class="flex h-7 shrink-0 items-center justify-between border-t border-subtle bg-bg px-3 text-[11px] tracking-wide text-muted"
			>
				<span>{visiblePhotos.length} visible</span>
				<span>{workspace.selectedIds.length} selected</span>
			</footer>
		{/if}
	</section>

	<PhotoDetailRail {workspace} />
</div>

<CollectionDialog
	bind:open={workspace.collectionDialogOpen}
	onCreate={(name) => workspace.createCollection(name, [])}
/>

<RemovePhotosDialog
	ids={removalIds}
	onCancel={() => (removalIds = null)}
	onConfirm={confirmRemoval}
/>
