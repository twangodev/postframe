<script lang="ts">
	import { Dialog, ToggleGroup } from 'bits-ui';
	import {
		Album,
		Box,
		Clock3,
		Flag,
		Folder,
		FolderPlus,
		Grid2X2,
		Image,
		Layers3,
		List,
		Search,
		Star,
		Ungroup,
		X
	} from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import {
		formatBytes,
		type ColorLabel,
		type Photo,
		type WorkspaceState
	} from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
	let search = $state('');
	let view = $state('grid');
	let source = $state('all');
	let sort = $state('capture');
	let albumDialogOpen = $state(false);
	let albumName = $state('');

	const active = $derived(workspace.selectedPhoto);
	const selectedStack = $derived(
		workspace.stacks.find((stack) =>
			workspace.selectedIds.some((id) => stack.photoIds.includes(id))
		)
	);
	const visiblePhotos = $derived.by(() => {
		const query = search.trim().toLowerCase();
		let photos = workspace.photos.filter((photo) => {
			if (query && !photo.name.toLowerCase().includes(query)) return false;
			if (source === 'favorites' && !photo.flagged) return false;
			if (source.startsWith('album:') && !photo.albumIds.includes(source.slice(6))) return false;
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

	function countForAlbum(albumId: string) {
		return workspace.photos.filter((photo) => photo.albumIds.includes(albumId)).length;
	}

	function stackFor(photo: Photo) {
		return workspace.stacks.find((stack) => stack.id === photo.stackId);
	}

	function createAlbum(event: SubmitEvent) {
		event.preventDefault();
		workspace.createAlbum(albumName);
		albumName = '';
		albumDialogOpen = false;
	}

	function dimensions(photo: Photo) {
		return photo.width && photo.height ? `${photo.width} × ${photo.height}` : 'Preview pending';
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
	class="bg-bg grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_16rem] max-[1080px]:grid-cols-[11rem_minmax(0,1fr)_14rem]"
>
	<aside class="motion-panel-left border-subtle bg-bg min-h-0 overflow-y-auto border-r py-3">
		<div class="text-muted px-3 pb-2 text-[10px] tracking-[0.04em]">library</div>
		<nav class="space-y-0.5 px-2" aria-label="Library">
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] transition-colors {source ===
				'all'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'all')}
			>
				<Image size={13} strokeWidth={1.5} />
				<span class="flex-1">all photos</span>
				<span class="font-mono text-[10px]">{workspace.photos.length}</span>
			</button>
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] transition-colors {source ===
				'recent'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'recent')}
			>
				<Clock3 size={13} strokeWidth={1.5} />
				<span class="flex-1">recent</span>
				<span class="font-mono text-[10px]">{workspace.photos.length}</span>
			</button>
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] transition-colors {source ===
				'favorites'
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (source = 'favorites')}
			>
				<Flag size={13} strokeWidth={1.5} />
				<span class="flex-1">favorites</span>
				<span class="font-mono text-[10px]">
					{workspace.photos.filter((photo) => photo.flagged).length}
				</span>
			</button>
		</nav>

		<div class="bg-subtle mx-3 my-3 h-px"></div>
		<div class="flex items-center justify-between px-3 pb-2">
			<span class="text-muted text-[10px] tracking-[0.04em]">collections</span>
		</div>
		<div class="px-2">
			<button
				type="button"
				class="bg-surface text-text flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px]"
				onclick={() => (source = 'all')}
			>
				<Folder size={13} strokeWidth={1.5} />
				<span class="min-w-0 flex-1 truncate">{workspace.collectionName}</span>
				<span class="text-muted font-mono text-[10px]">{workspace.photos.length}</span>
			</button>
		</div>

		<div class="bg-subtle mx-3 my-3 h-px"></div>
		<div class="flex items-center justify-between px-3 pb-2">
			<span class="text-muted text-[10px] tracking-[0.04em]">albums</span>
			<Tooltip text="Create album">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Create album"
						class="text-muted hover:text-text cursor-pointer rounded transition-colors"
						onclick={() => (albumDialogOpen = true)}
					>
						<FolderPlus size={13} strokeWidth={1.5} />
					</button>
				{/snippet}
			</Tooltip>
		</div>
		<div class="space-y-0.5 px-2">
			{#each workspace.albums as album (album.id)}
				<button
					type="button"
					class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] transition-colors {source ===
					`album:${album.id}`
						? 'bg-surface text-text'
						: 'text-muted hover:bg-surface/60 hover:text-text'}"
					onclick={() => (source = `album:${album.id}`)}
				>
					<Album size={13} strokeWidth={1.5} />
					<span class="min-w-0 flex-1 truncate">{album.name}</span>
					<span class="font-mono text-[10px]">{countForAlbum(album.id)}</span>
				</button>
			{/each}
			{#if workspace.albums.length === 0}
				<p class="text-muted/65 px-2 py-2 text-[10px] leading-relaxed">no albums yet.</p>
			{/if}
		</div>
	</aside>

	<section class="motion-panel-up bg-canvas flex min-h-0 min-w-0 flex-col">
		<div class="border-subtle bg-bg flex h-11 shrink-0 items-center gap-2 border-b px-3">
			<label class="relative max-w-72 min-w-32 flex-1">
				<Search
					size={13}
					strokeWidth={1.5}
					class="text-muted pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
				/>
				<input
					bind:value={search}
					placeholder="search this collection"
					class="border-subtle bg-surface text-text placeholder:text-muted/60 focus:border-accent h-7 w-full rounded border pr-2 pl-7 text-[10px] focus:outline-none"
				/>
			</label>

			<select
				bind:value={sort}
				aria-label="Sort photos"
				class="border-subtle bg-surface text-muted focus:border-accent h-7 cursor-pointer rounded border px-2 text-[10px] focus:outline-none"
			>
				<option value="capture">capture time</option>
				<option value="name">filename</option>
				<option value="rating">rating</option>
			</select>

			<div class="ml-auto flex items-center gap-1">
				{#if selectedStack}
					<button
						type="button"
						class="border-subtle text-muted hover:text-text flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-[10px] transition-colors"
						onclick={() => workspace.ungroupStack(selectedStack.id)}
					>
						<Ungroup size={12} /> ungroup
					</button>
				{:else}
					<button
						type="button"
						disabled={workspace.selectedIds.length < 2}
						class="border-subtle text-muted hover:text-text flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
						onclick={() => workspace.createStack()}
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

		<div class="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
			{#if visiblePhotos.length > 0}
				<div
					class={view === 'grid'
						? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3'
						: 'border-subtle bg-subtle flex flex-col gap-px overflow-hidden rounded border'}
				>
					{#each visiblePhotos as photo, index (photo.id)}
						{@const stack = stackFor(photo)}
						<div
							role="button"
							tabindex="0"
							aria-label={`Select ${photo.name}`}
							class={view === 'grid'
								? `motion-card group bg-bg min-w-0 cursor-pointer rounded border p-1.5 ${workspace.selectedIds.includes(photo.id) ? 'border-accent' : 'border-subtle hover:border-muted'}`
								: `motion-card group bg-bg grid h-14 cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)_5rem_5rem] items-center gap-3 px-2 ${workspace.selectedIds.includes(photo.id) ? 'bg-surface' : 'hover:bg-surface/65'}`}
							style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
							onclick={(event) => workspace.selectPhoto(photo.id, event.metaKey || event.ctrlKey)}
							ondblclick={() => workspace.editPhoto(photo.id)}
							onkeydown={(event) => event.key === 'Enter' && workspace.editPhoto(photo.id)}
						>
							<div
								class={view === 'grid'
									? 'bg-surface relative aspect-[4/3] overflow-hidden rounded-sm'
									: 'bg-surface relative h-11 overflow-hidden rounded-sm'}
							>
								<PhotoVisual {photo} />
								{#if stack}
									<button
										type="button"
										aria-label={stack.collapsed ? 'Expand stack' : 'Collapse stack'}
										class="absolute right-1 bottom-1 flex h-5 cursor-pointer items-center gap-1 rounded-sm bg-black/65 px-1.5 font-mono text-[10px] text-white backdrop-blur"
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
								<p class="text-text truncate font-mono text-[10px]">{photo.name}</p>
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
								<span class="text-muted font-mono text-[10px]">{photo.extension}</span>
								<span class="text-muted font-mono text-[10px]">{formatBytes(photo.size)}</span>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-center">
					<Box size={28} strokeWidth={1} class="text-muted mb-3" />
					<p class="text-text text-xs">no photos in this view</p>
					<p class="text-muted mt-1 text-[10px]">try another album or clear the search.</p>
				</div>
			{/if}
		</div>

		<footer
			class="border-subtle bg-bg text-muted flex h-7 shrink-0 items-center justify-between border-t px-3 text-[10px] tracking-wide"
		>
			<span>{visiblePhotos.length} visible</span>
			<span>{workspace.selectedIds.length} selected</span>
		</footer>
	</section>

	<aside class="motion-panel-right border-subtle bg-bg min-h-0 overflow-y-auto border-l">
		{#if active}
			{#key active.id}
				<div class="motion-photo border-subtle bg-canvas aspect-[4/3] overflow-hidden border-b">
					<PhotoVisual photo={active} />
				</div>
			{/key}
			<div class="border-subtle border-b p-3">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate text-[11px] font-medium">{active.name}</p>
						<p class="text-muted mt-1 font-mono text-[10px]">
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
				<p class="text-muted mb-3 text-[10px] tracking-[0.04em]">metadata</p>
				<dl class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-[10px]">
					<dt class="text-muted">captured</dt>
					<dd class="text-text/80 text-right">{active.captured}</dd>
					<dt class="text-muted">dimensions</dt>
					<dd class="text-text/80 text-right font-mono">{dimensions(active)}</dd>
					<dt class="text-muted">camera</dt>
					<dd class="text-text/80 text-right">FUJIFILM X-T5</dd>
					<dt class="text-muted">lens</dt>
					<dd class="text-text/80 text-right">XF 23mm F1.4</dd>
					<dt class="text-muted">exposure</dt>
					<dd class="text-text/80 text-right font-mono">1/250 · f/2.8 · ISO 160</dd>
				</dl>
			</div>

			<div class="p-3">
				<p class="text-muted mb-2 text-[10px] tracking-[0.04em]">albums</p>
				<div class="space-y-1">
					{#each workspace.albums as album (album.id)}
						<label
							class="text-muted hover:text-text flex cursor-pointer items-center gap-2 py-1 text-[11px]"
						>
							<input
								type="checkbox"
								checked={active.albumIds.includes(album.id)}
								onchange={() => workspace.toggleAlbum(active.id, album.id)}
								class="accent-accent"
							/>
							{album.name}
						</label>
					{/each}
					{#if workspace.albums.length === 0}
						<button
							type="button"
							class="text-muted hover:text-text cursor-pointer text-[11px] transition-colors"
							onclick={() => (albumDialogOpen = true)}
						>
							+ create an album
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="text-muted flex h-full items-center justify-center px-6 text-center text-[10px]">
				select a photo to inspect it.
			</div>
		{/if}
	</aside>
</div>

<Dialog.Root bind:open={albumDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
		<Dialog.Content
			class="motion-dialog-content border-subtle bg-bg fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl"
		>
			<form onsubmit={createAlbum}>
				<div class="flex items-start justify-between">
					<div>
						<Dialog.Title class="text-sm font-medium tracking-tight">create album</Dialog.Title>
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
					bind:value={albumName}
					placeholder="album name"
					class="border-subtle bg-surface placeholder:text-muted/50 focus:border-accent mt-5 w-full rounded border px-3 py-2 text-xs focus:outline-none"
				/>
				<div class="mt-4 flex justify-end">
					<button
						type="submit"
						disabled={!albumName.trim()}
						class="bg-text text-bg cursor-pointer rounded px-3 py-2 text-[10px] disabled:opacity-35"
					>
						create album
					</button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
