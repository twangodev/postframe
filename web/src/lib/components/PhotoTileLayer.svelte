<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { planPhotoTiles, type PhotoTile } from '$lib/photo-tiles';
	import type { Size, ViewportTransform } from '$lib/photo-viewport';
	import type { RenderTileRequest } from '$lib/worker';

	interface Props {
		photoId: string;
		enabled: boolean;
		viewport: Size;
		image: Size;
		transform: ViewportTransform;
		renderTile: (photoId: string, tile: RenderTileRequest) => Promise<ArrayBuffer>;
		ev?: number;
		tone?: boolean;
	}

	interface TileAsset extends PhotoTile {
		cacheKey: string;
		src: string;
	}

	let {
		photoId,
		enabled,
		viewport,
		image,
		transform,
		renderTile,
		ev = 0,
		tone = true
	}: Props = $props();
	let pixelRatio = $state(1);
	let visibleAssets = $state<TileAsset[]>([]);
	let cacheDocumentKey = '';
	let generation = 0;
	const cache = new Map<string, TileAsset>();
	const plannedTiles = $derived(planPhotoTiles(viewport, image, transform, pixelRatio));

	onMount(() => {
		pixelRatio = window.devicePixelRatio;
	});

	$effect(() => {
		const documentKey = `${photoId}:${image.width}:${image.height}`;
		const tiles = plannedTiles;
		const settingsKey = `${ev}:${tone}`;
		if (cacheDocumentKey !== documentKey) {
			clearCache();
			cacheDocumentKey = documentKey;
		}

		generation += 1;
		const currentGeneration = generation;
		visibleAssets = enabled ? cachedAssets(tiles) : [];
		if (!enabled || tiles.length === 0) return;

		const timer = window.setTimeout(() => {
			void renderPlan(photoId, documentKey, settingsKey, tiles, currentGeneration, ev, tone);
		}, 90);
		return () => window.clearTimeout(timer);
	});

	onDestroy(clearCache);

	async function renderPlan(
		requestedPhotoId: string,
		requestedDocumentKey: string,
		settingsKey: string,
		tiles: PhotoTile[],
		requestedGeneration: number,
		requestedEv: number,
		requestedTone: boolean
	) {
		for (const tile of tiles) {
			if (requestedGeneration !== generation) return;
			const cacheKey = tileCacheKey(tile, settingsKey);
			if (cache.has(cacheKey)) continue;

			try {
				const png = await renderTile(requestedPhotoId, {
					x: tile.x,
					y: tile.y,
					width: tile.width,
					height: tile.height,
					bin: tile.bin,
					ev: requestedEv,
					tone: requestedTone
				});
				if (requestedDocumentKey !== cacheDocumentKey || requestedPhotoId !== photoId) return;
				const asset = {
					...tile,
					cacheKey,
					src: URL.createObjectURL(new Blob([png], { type: 'image/png' }))
				};
				cache.set(cacheKey, asset);
				pruneCache(new Set(tiles.map((candidate) => tileCacheKey(candidate, settingsKey))));
				if (requestedGeneration === generation) visibleAssets = cachedAssets(tiles);
			} catch {
				return;
			}
		}
	}

	function cachedAssets(tiles: PhotoTile[]) {
		return tiles
			.map((tile) => cache.get(tileCacheKey(tile)))
			.filter((asset): asset is TileAsset => asset !== undefined);
	}

	function tileCacheKey(tile: PhotoTile, settingsKey = `${ev}:${tone}`) {
		return `${settingsKey}:${tile.key}`;
	}

	function pruneCache(activeKeys: Set<string>) {
		for (const [key, asset] of cache) {
			if (cache.size <= 96) return;
			if (activeKeys.has(key)) continue;
			URL.revokeObjectURL(asset.src);
			cache.delete(key);
		}
	}

	function clearCache() {
		for (const asset of cache.values()) URL.revokeObjectURL(asset.src);
		cache.clear();
		visibleAssets = [];
	}
</script>

<div class="pointer-events-none absolute inset-0" aria-hidden="true">
	{#each visibleAssets as tile (tile.cacheKey)}
		<img
			src={tile.src}
			alt=""
			draggable="false"
			width={tile.outputWidth}
			height={tile.outputHeight}
			class="motion-tile absolute max-w-none select-none"
			style={`left: ${tile.x}px; top: ${tile.y}px; width: ${tile.width}px; height: ${tile.height}px;`}
		/>
	{/each}
</div>
