<script lang="ts">
	import { Dialog, ToggleGroup } from 'bits-ui';
	import {
		Box,
		Clock3,
		Flag,
		Folder,
		FolderPlus,
		Grid2X2,
		Image,
		ImagePlus,
		Layers3,
		List,
		Search,
		Star,
		Ungroup,
		X
	} from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';
	import ContextMenu from './ui/ContextMenu.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import { contextTargets, photoMenu, type PhotoMenuAction } from '$lib/photo-menu';
	import {
		formatBytes,
		type ColorLabel,
		type Photo,
		type WorkspaceState
	} from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onImport: (files: File[]) => Promise<void>;
	}

	let { workspace, onImport }: Props = $props();
	let search = $state('');
	let view = $state('grid');
	let source = $state('all');
	let sort = $state('capture');
	let collectionName = $state('');
	let collectionBusy = $state(false);
	let importing = $state(false);
	let removalIds = $state<string[] | null>(null);
	const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

	const active = $derived(workspace.selectedPhoto);
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

	async function createCollection(event: SubmitEvent) {
		event.preventDefault();
		if (!collectionName.trim() || collectionBusy) return;
		collectionBusy = true;
		try {
			await workspace.createCollection(collectionName, []);
			collectionName = '';
		} finally {
			collectionBusy = false;
		}
	}

	async function importFiles(list: FileList | null) {
		if (!list?.length) return;
		importing = true;
		await onImport([...list]);
		importing = false;
	}

	function dimensions(photo: Photo) {
		return photo.width && photo.height ? `${photo.width} × ${photo.height}` : '—';
	}

	function camera(photo: Photo) {
		return (
			[photo.metadata?.cameraMake, photo.metadata?.cameraModel].filter(Boolean).join(' ') || '—'
		);
	}

	function exposure(photo: Photo) {
		const metadata = photo.metadata;
		if (!metadata) return '—';
		const values = [
			formatExposureTime(metadata.exposureSeconds),
			metadata.fNumber ? `f/${formatDecimal(metadata.fNumber)}` : null,
			metadata.iso ? `ISO ${metadata.iso}` : null
		].filter(Boolean);
		return values.join(' · ') || '—';
	}

	function formatExposureTime(seconds: number | null) {
		if (!seconds) return null;
		if (seconds >= 1) return `${formatDecimal(seconds)}s`;
		return `1/${Math.round(1 / seconds)}`;
	}

	function formatDecimal(value: number) {
		return Number(value.toFixed(1)).toString();
	}

	const colors: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];
	const labelColors: Record<ColorLabel, string> = {
		none: 'var(--color-muted)',
		red: '#c26f68',
		yellow: '#c4a35a',
		green: '#6fa878',
		blue: '#5e8fc9',
		purple: '#9676b8'
	};
</script>

<div
	class={workspace.photos.length === 0
		? 'bg-bg grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] max-[1080px]:grid-cols-[11rem_minmax(0,1fr)]'
		: 'bg-bg grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_16rem] max-[1080px]:grid-cols-[11rem_minmax(0,1fr)_14rem]'}
>
	<aside class="motion-panel-left border-subtle bg-bg min-h-0 overflow-y-auto border-r py-3">
		<div class="text-muted px-3 pb-2 text-[11px] tracking-[0.04em]">library</div>
		<nav class="space-y-0.5 px-2" aria-label="Library">
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {source ===
				'all'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'all')}
			>
				<Image size={13} strokeWidth={1.5} />
				<span class="flex-1">all photos</span>
				<span class="font-mono text-[11px]">{workspace.photos.length}</span>
			</button>
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {source ===
				'recent'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'recent')}
			>
				<Clock3 size={13} strokeWidth={1.5} />
				<span class="flex-1">recent</span>
				<span class="font-mono text-[11px]">{recentCount}</span>
			</button>
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {source ===
				'favorites'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'favorites')}
			>
				<Flag size={13} strokeWidth={1.5} />
				<span class="flex-1">favorites</span>
				<span class="font-mono text-[11px]">
					{workspace.photos.filter((photo) => photo.flagged).length}
				</span>
			</button>
		</nav>

		<div class="bg-subtle mx-3 my-3 h-px"></div>
		<div class="flex items-center justify-between px-3 pb-2">
			<span class="text-muted text-[11px] tracking-[0.04em]">collections</span>
			<Tooltip text="Create collection">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Create collection"
						class="text-muted hover:text-text cursor-pointer rounded transition-colors"
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
					class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {source ===
					`collection:${collection.id}`
						? 'bg-surface text-text'
						: 'text-muted hover:bg-surface/60 hover:text-text'}"
					onclick={() => (source = `collection:${collection.id}`)}
				>
					<Folder size={13} strokeWidth={1.5} />
					<span class="min-w-0 flex-1 truncate">{collection.name}</span>
					<span class="font-mono text-[11px]">{collection.photoIds.length}</span>
				</button>
			{/each}
			{#if workspace.collections.length === 0}
				<p class="text-muted/65 px-2 py-2 text-[11px] leading-relaxed">no collections yet.</p>
			{/if}
		</div>
	</aside>

	<section class="motion-panel-up bg-canvas flex min-h-0 min-w-0 flex-col">
		{#if workspace.photos.length > 0}
			<div class="border-subtle bg-bg flex h-11 shrink-0 items-center gap-2 border-b px-3">
				<label class="relative max-w-72 min-w-32 flex-1">
					<Search
						size={13}
						strokeWidth={1.5}
						class="text-muted pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
					/>
					<input
						bind:value={search}
						placeholder="search photos"
						class="border-subtle bg-surface text-text placeholder:text-muted/60 focus:border-accent h-7 w-full rounded border pr-2 pl-7 text-[11px] focus:outline-none"
					/>
				</label>

				<select
					bind:value={sort}
					aria-label="Sort photos"
					class="border-subtle bg-surface text-muted focus:border-accent h-7 cursor-pointer rounded border px-2 text-[11px] focus:outline-none"
				>
					<option value="capture">capture time</option>
					<option value="name">filename</option>
					<option value="rating">rating</option>
				</select>

				<div class="ml-auto flex items-center gap-1">
					{#if selectedStack}
						<button
							type="button"
							class="border-subtle text-muted hover:text-text flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-[11px] transition-colors"
							onclick={() => workspace.ungroupStack(selectedStack.id)}
						>
							<Ungroup size={12} /> ungroup
						</button>
					{:else}
						<button
							type="button"
							disabled={workspace.selectedIds.length < 2}
							class="border-subtle text-muted hover:text-text flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
							onclick={workspace.createStack}
						>
							<Layers3 size={12} /> group stack
						</button>
					{/if}

					<ToggleGroup.Root
						type="single"
						value={view}
						onValueChange={(value) => value && (view = value)}
						class="border-subtle bg-surface flex h-7 rounded border p-0.5"
					>
						<ToggleGroup.Item
							value="grid"
							aria-label="Grid view"
							class="text-muted data-[state=on]:bg-elevated data-[state=on]:text-text flex size-6 cursor-pointer items-center justify-center rounded-sm"
						>
							<Grid2X2 size={12} />
						</ToggleGroup.Item>
						<ToggleGroup.Item
							value="list"
							aria-label="List view"
							class="text-muted data-[state=on]:bg-elevated data-[state=on]:text-text flex size-6 cursor-pointer items-center justify-center rounded-sm"
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
						class="border-subtle bg-surface text-muted mb-4 flex size-10 items-center justify-center rounded border"
					>
						<ImagePlus size={17} strokeWidth={1.25} />
					</div>
					<p class="text-text text-xs font-medium">empty library</p>
					<p class="text-muted mt-1 text-[11px]">add photographs when you're ready.</p>
					<label
						class="bg-text text-bg mt-4 flex h-8 cursor-pointer items-center rounded px-3 text-[11px] font-medium hover:opacity-85"
					>
						<input
							type="file"
							multiple
							accept={workspace.acceptedPhotos}
							class="sr-only"
							disabled={importing}
							onchange={(event) => importFiles(event.currentTarget.files)}
						/>
						import photos
					</label>
				</div>
			{:else if visiblePhotos.length > 0}
				<div
					class={view === 'grid'
						? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3'
						: 'border-subtle bg-subtle flex flex-col gap-px overflow-hidden rounded border'}
				>
					{#each visiblePhotos as photo, index (photo.id)}
						{@const stack = stackFor(photo)}
						<ContextMenu
							items={cardMenu(photo)}
							onOpen={() => openCardMenu(photo)}
							onAction={(action) => runPhotoAction(action, photo)}
						>
							{#snippet children({ props })}
								<div
									{...props}
									role="button"
									tabindex="0"
									aria-label={`Select ${photo.name}`}
									class={view === 'grid'
										? `motion-card group bg-bg min-w-0 cursor-pointer rounded border p-1.5 ${workspace.selectedIds.includes(photo.id) ? 'border-accent' : 'border-subtle hover:border-muted'}`
										: `motion-card group bg-bg grid h-14 cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)_5rem_5rem] items-center gap-3 px-2 ${workspace.selectedIds.includes(photo.id) ? 'bg-surface' : 'hover:bg-surface/65'}`}
									style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
									onclick={(event) =>
										workspace.selectPhoto(photo.id, event.metaKey || event.ctrlKey)}
									ondblclick={() => workspace.editPhoto(photo.id)}
									onkeydown={(event) => event.key === 'Enter' && workspace.editPhoto(photo.id)}
								>
									<div
										class={view === 'grid'
											? 'bg-surface relative aspect-[4/3] overflow-hidden rounded-sm'
											: 'bg-surface relative h-11 overflow-hidden rounded-sm'}
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
											<Flag
												size={11}
												class="absolute top-1 left-1 fill-white text-white drop-shadow"
											/>
										{/if}
									</div>

									<div class={view === 'grid' ? 'min-w-0 px-0.5 pt-2 pb-0.5' : 'min-w-0'}>
										<p class="text-text truncate font-mono text-[11px]">{photo.name}</p>
										{#if view === 'grid'}
											<div class="mt-1.5 flex items-center justify-between">
												<div class="flex">
													{#each [1, 2, 3, 4, 5] as rating}
														<button
															type="button"
															aria-label={`Rate ${rating} stars`}
															class="text-muted/55 hover:text-text cursor-pointer transition-colors"
															onclick={(event) => {
																event.stopPropagation();
																workspace.setRating(photo.id, rating);
															}}
														>
															<Star
																size={10}
																class={photo.rating >= rating ? 'fill-text text-text' : ''}
															/>
														</button>
													{/each}
												</div>
												<span
													class="size-1.5 rounded-full"
													style:background={labelColors[photo.colorLabel]}
													style:opacity={photo.colorLabel === 'none' ? 0.3 : 1}
												></span>
											</div>
										{/if}
									</div>
									{#if view === 'list'}
										<span class="text-muted font-mono text-[11px]">{photo.extension}</span>
										<span class="text-muted font-mono text-[11px]">{formatBytes(photo.size)}</span>
									{/if}
								</div>
							{/snippet}
						</ContextMenu>
					{/each}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-center">
					<Box size={28} strokeWidth={1} class="text-muted mb-3" />
					<p class="text-text text-xs">no photos in this view</p>
					<p class="text-muted mt-1 text-[11px]">try another collection or clear the search.</p>
				</div>
			{/if}
		</div>

		{#if workspace.photos.length > 0}
			<footer
				class="border-subtle bg-bg text-muted flex h-7 shrink-0 items-center justify-between border-t px-3 text-[11px] tracking-wide"
			>
				<span>{visiblePhotos.length} visible</span>
				<span>{workspace.selectedIds.length} selected</span>
			</footer>
		{/if}
	</section>

	<aside
		class="motion-panel-right border-subtle bg-bg min-h-0 overflow-y-auto border-l {workspace.photos
			.length === 0
			? 'hidden'
			: ''}"
	>
		{#if active}
			{#key active.id}
				<div class="motion-photo border-subtle bg-canvas aspect-[4/3] overflow-hidden border-b">
					<PhotoVisual photo={active} onRequest={workspace.loadThumbnail} />
				</div>
			{/key}
			<div class="border-subtle border-b p-3">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate text-[12px] font-medium">{active.name}</p>
						<p class="text-muted mt-1 font-mono text-[11px]">
							{active.extension} · {formatBytes(active.size)}
						</p>
					</div>
					<button
						type="button"
						aria-label={active.flagged ? 'Remove flag' : 'Flag photo'}
						class="text-muted hover:text-text cursor-pointer rounded p-1 transition-colors"
						onclick={() => workspace.toggleFlag(active.id)}
					>
						<Flag size={14} class={active.flagged ? 'fill-text text-text' : ''} />
					</button>
				</div>
				<div class="mt-3 flex items-center justify-between">
					<div class="flex gap-0.5">
						{#each [1, 2, 3, 4, 5] as rating}
							<button
								type="button"
								aria-label={`Rate ${rating} stars`}
								class="text-muted hover:text-text cursor-pointer transition-colors"
								onclick={() => workspace.setRating(active.id, rating)}
							>
								<Star size={12} class={active.rating >= rating ? 'fill-text text-text' : ''} />
							</button>
						{/each}
					</div>
					<div class="flex gap-1.5">
						{#each colors as color}
							<button
								type="button"
								aria-label={`${color} label`}
								class="ring-offset-bg size-2.5 cursor-pointer rounded-full ring-offset-1 {active.colorLabel ===
								color
									? 'ring-text ring-1'
									: 'opacity-55 hover:opacity-100'}"
								style:background={labelColors[color]}
								onclick={() => workspace.setColorLabel(active.id, color)}
							></button>
						{/each}
					</div>
				</div>
			</div>

			<div class="border-subtle border-b p-3">
				<p class="text-muted mb-3 text-[11px] tracking-[0.04em]">metadata</p>
				<dl class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-[11px]">
					<dt class="text-muted">captured</dt>
					<dd class="text-text/80 text-right">{active.captured}</dd>
					<dt class="text-muted">dimensions</dt>
					<dd class="text-text/80 text-right font-mono">{dimensions(active)}</dd>
					<dt class="text-muted">camera</dt>
					<dd class="text-text/80 text-right">{camera(active)}</dd>
					<dt class="text-muted">lens</dt>
					<dd class="text-text/80 text-right">{active.metadata?.lens ?? '—'}</dd>
					<dt class="text-muted">focal length</dt>
					<dd class="text-text/80 text-right font-mono">
						{active.metadata?.focalLengthMm
							? `${formatDecimal(active.metadata.focalLengthMm)} mm`
							: '—'}
					</dd>
					<dt class="text-muted">exposure</dt>
					<dd class="text-text/80 text-right font-mono">{exposure(active)}</dd>
				</dl>
			</div>

			<div class="p-3">
				<p class="text-muted mb-2 text-[11px] tracking-[0.04em]">collections</p>
				<div class="space-y-1">
					{#each workspace.collections as collection (collection.id)}
						<label
							class="text-muted hover:text-text flex cursor-pointer items-center gap-2 py-1 text-[12px]"
						>
							<input
								type="checkbox"
								checked={collection.photoIds.includes(active.id)}
								onchange={() => workspace.toggleCollection(active.id, collection.id)}
								class="accent-accent"
							/>
							{collection.name}
						</label>
					{/each}
					{#if workspace.collections.length === 0}
						<button
							type="button"
							class="text-muted hover:text-text cursor-pointer text-[12px] transition-colors"
							onclick={workspace.requestCollectionCreation}
						>
							+ create a collection
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="text-muted flex h-full items-center justify-center px-6 text-center text-[11px]">
				select a photo to inspect it.
			</div>
		{/if}
	</aside>
</div>

<Dialog.Root bind:open={workspace.collectionDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
		<CenteredDialogContent size="sm" class="p-5">
			<form onsubmit={createCollection}>
				<div class="flex items-start justify-between">
					<div>
						<Dialog.Title class="text-sm font-medium tracking-tight">create collection</Dialog.Title
						>
						<Dialog.Description class="text-muted mt-1 text-xs">
							selected photos will be added automatically.
						</Dialog.Description>
					</div>
					<Dialog.Close
						class="text-muted hover:text-text cursor-pointer rounded p-1"
						aria-label="Close"
					>
						<X size={15} />
					</Dialog.Close>
				</div>
				<input
					bind:value={collectionName}
					placeholder="collection name"
					class="border-subtle bg-surface placeholder:text-muted/50 focus:border-accent mt-5 w-full rounded border px-3 py-2 text-xs focus:outline-none"
				/>
				<div class="mt-4 flex justify-end">
					<button
						type="submit"
						disabled={!collectionName.trim() || collectionBusy}
						class="bg-text text-bg cursor-pointer rounded px-3 py-2 text-[11px] disabled:opacity-35"
					>
						create collection
					</button>
				</div>
			</form>
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root
	open={removalIds !== null}
	onOpenChange={(open) => {
		if (!open) removalIds = null;
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
		<CenteredDialogContent size="sm" class="p-5">
			<div class="flex items-start justify-between">
				<div>
					<Dialog.Title class="text-sm font-medium tracking-tight">
						remove {removalIds?.length === 1 ? 'photo' : `${removalIds?.length} photos`} from library
					</Dialog.Title>
					<Dialog.Description class="text-muted mt-1 text-xs">
						local files and edits are deleted. this cannot be undone.
					</Dialog.Description>
				</div>
				<Dialog.Close
					class="text-muted hover:text-text cursor-pointer rounded p-1"
					aria-label="Close"
				>
					<X size={15} />
				</Dialog.Close>
			</div>
			<div class="mt-5 flex justify-end gap-2">
				<Dialog.Close
					class="border-subtle text-muted hover:text-text cursor-pointer rounded border px-3 py-2 text-[11px]"
				>
					cancel
				</Dialog.Close>
				<button
					type="button"
					class="bg-negative text-bg cursor-pointer rounded px-3 py-2 text-[11px]"
					onclick={confirmRemoval}
				>
					remove
				</button>
			</div>
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>
