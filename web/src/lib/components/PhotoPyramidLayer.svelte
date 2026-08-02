<script lang="ts">
	import type OpenSeadragon from 'openseadragon';
	import { onMount } from 'svelte';
	import {
		createPostframeTileSource,
		type PyramidTileEvent,
		type PyramidTilePhase
	} from '$lib/postframe-tile-source';
	import { PIXEL_GRID_START_SCALE, surfaceTransform } from '$lib/photo-viewport';
	import type { Size, ViewportTransform } from '$lib/photo-viewport';
	import type { RenderTileRequest } from '$lib/worker';

	interface Props {
		photoId: string;
		enabled: boolean;
		viewport: Size;
		image: Size;
		transform: ViewportTransform;
		renderTile: (photoId: string, tile: RenderTileRequest) => Promise<ArrayBuffer>;
		renderRevision: number;
		ev?: number;
		tone?: boolean;
	}

	interface Diagnostics {
		rendering: number;
		decoded: number;
		failed: number;
		fullyLoaded: boolean;
	}

	let {
		photoId,
		enabled,
		viewport,
		image,
		transform,
		renderTile,
		renderRevision,
		ev = 0,
		tone = true
	}: Props = $props();
	let container: HTMLDivElement;
	let openSeadragon = $state<typeof OpenSeadragon | null>(null);
	let viewer = $state<OpenSeadragon.Viewer | null>(null);
	let opened = $state(false);
	let debug = $state(false);
	let diagnostics = $state<Diagnostics>(emptyDiagnostics());
	let resizedViewport: Size | null = null;
	let imageSmoothingEnabled: boolean | null = null;
	let sourceKey: string | null = null;
	let renderedRevision = -1;
	let generation = 0;
	let activeItem: OpenSeadragon.TiledImage | null = null;
	let pendingItem: OpenSeadragon.TiledImage | null = null;
	const tilePhases = new Map<string, PyramidTilePhase>();

	onMount(() => {
		let cancelled = false;
		debug = import.meta.env.DEV && new URLSearchParams(window.location.search).has('tiles');
		void import('openseadragon').then(({ default: library }) => {
			if (cancelled) return;
			openSeadragon = library;
			viewer = library({
				element: container,
				showNavigationControl: false,
				mouseNavEnabled: false,
				keyboardNavEnabled: false,
				autoResize: false,
				immediateRender: false,
				blendTime: 0.12,
				alwaysBlend: false,
				drawer: ['webgl', 'canvas'],
				imageLoaderLimit: 1,
				maxImageCacheCount: 128,
				maxTilesPerFrame: 4,
				timeout: 30_000,
				tileRetryMax: 2,
				tileRetryDelay: 250,
				visibilityRatio: 0,
				minZoomImageRatio: 0.001,
				maxZoomPixelRatio: 32,
				debugMode: debug
			});
			viewer.addHandler('open', () => {
				activeItem = viewer?.world.getItemAt(0) ?? null;
				pendingItem = null;
				resizedViewport = null;
				imageSmoothingEnabled = null;
				opened = true;
			});
			viewer.addHandler('fully-loaded-change', (event) => {
				diagnostics = { ...diagnostics, fullyLoaded: event.fullyLoaded };
			});
			viewer.addHandler('tile-load-failed', (event) => {
				console.warn(`Tile ${event.tile.toString()} failed: ${event.message}`);
			});
		});

		return () => {
			cancelled = true;
			viewer?.destroy();
			viewer = null;
		};
	});

	$effect(() => {
		if (!viewer || !openSeadragon) return;
		const nextSourceKey = `${photoId}:${image.width}:${image.height}`;
		if (!enabled) {
			generation += 1;
			sourceKey = null;
			renderedRevision = -1;
			activeItem = null;
			pendingItem = null;
			opened = false;
			resetDiagnostics();
			viewer.close();
			return;
		}

		if (sourceKey !== nextSourceKey) {
			generation += 1;
			sourceKey = nextSourceKey;
			renderedRevision = renderRevision;
			activeItem = null;
			pendingItem = null;
			opened = false;
			resetDiagnostics();
			viewer.open({ tileSource: tileSource(renderRevision, ev, tone) });
			return;
		}

		if (!opened || renderedRevision === renderRevision) return;
		renderedRevision = renderRevision;
		queueReplacement(renderRevision, ev, tone);
	});

	$effect(() => {
		if (!viewer || !openSeadragon || !opened) return;
		const nextViewport = { width: viewport.width, height: viewport.height };
		if (
			resizedViewport?.width === nextViewport.width &&
			resizedViewport.height === nextViewport.height
		) {
			return;
		}

		viewer.viewport.resize(new openSeadragon.Point(nextViewport.width, nextViewport.height), true);
		resizedViewport = nextViewport;
	});

	$effect(() => {
		if (!viewer || !openSeadragon || !opened) return;
		const offset = surfaceTransform(viewport, image, transform);
		const sourceWidth = Math.max(1, image.width);
		viewer.viewport.fitBounds(
			new openSeadragon.Rect(
				-offset.x / transform.scale / sourceWidth,
				-offset.y / transform.scale / sourceWidth,
				viewport.width / transform.scale / sourceWidth,
				viewport.height / transform.scale / sourceWidth
			),
			true
		);

		const nextImageSmoothingEnabled = transform.scale < PIXEL_GRID_START_SCALE;
		if (imageSmoothingEnabled !== nextImageSmoothingEnabled) {
			viewer.drawer.setImageSmoothingEnabled(nextImageSmoothingEnabled);
			imageSmoothingEnabled = nextImageSmoothingEnabled;
		}
	});

	function handleTileEvent(event: PyramidTileEvent) {
		tilePhases.set(event.key, event.phase);
		diagnostics = {
			rendering: countPhase('rendering'),
			decoded: countPhase('decoded'),
			failed: countPhase('failed'),
			fullyLoaded: false
		};
	}

	function tileSource(revision: number, exposure: number, toneMapping: boolean) {
		return createPostframeTileSource(openSeadragon!, {
			photoId,
			revision,
			image,
			renderTile,
			ev: exposure,
			tone: toneMapping,
			onTileEvent: handleTileEvent
		});
	}

	function queueReplacement(revision: number, exposure: number, toneMapping: boolean) {
		if (!viewer) return;
		const nextGeneration = ++generation;
		if (pendingItem && viewer.world.getIndexOfItem(pendingItem) >= 0) {
			viewer.world.removeItem(pendingItem);
		}
		pendingItem = null;
		resetDiagnostics();

		viewer.addTiledImage({
			tileSource: tileSource(revision, exposure, toneMapping),
			opacity: 0,
			preload: true,
			success: (event) => {
				const item = (event as unknown as { item: OpenSeadragon.TiledImage }).item;
				if (!viewer || nextGeneration !== generation) {
					viewer?.world.removeItem(item);
					return;
				}
				pendingItem = item;
				item.whenFullyLoaded(() => publishReplacement(item, nextGeneration));
			}
		});
	}

	function publishReplacement(item: OpenSeadragon.TiledImage, itemGeneration: number) {
		if (!viewer || itemGeneration !== generation || viewer.world.getIndexOfItem(item) < 0) return;
		const previous = activeItem;
		item.setOpacity(1);
		activeItem = item;
		pendingItem = null;
		requestAnimationFrame(() => {
			if (!viewer || !previous || previous === activeItem) return;
			if (viewer.world.getIndexOfItem(previous) >= 0) viewer.world.removeItem(previous);
		});
	}

	function countPhase(phase: PyramidTilePhase) {
		return [...tilePhases.values()].filter((candidate) => candidate === phase).length;
	}

	function resetDiagnostics() {
		tilePhases.clear();
		diagnostics = emptyDiagnostics();
	}

	function emptyDiagnostics(): Diagnostics {
		return { rendering: 0, decoded: 0, failed: 0, fullyLoaded: false };
	}
</script>

<div data-photo-pyramid class="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
	<div bind:this={container} class="size-full"></div>
	{#if debug}
		<div
			data-pyramid-status
			class="border-subtle bg-bg/85 text-muted absolute bottom-3 left-3 rounded border px-2 py-1 font-mono text-[9px] shadow-lg backdrop-blur"
		>
			<span class={diagnostics.fullyLoaded ? 'text-accent' : 'text-text'}>
				{diagnostics.fullyLoaded ? 'covered' : 'loading'}
			</span>
			<span> · {diagnostics.rendering} rendering</span>
			<span> · {diagnostics.decoded} decoded</span>
			{#if diagnostics.failed > 0}
				<span class="text-red-400"> · {diagnostics.failed} failed</span>
			{/if}
		</div>
	{/if}
</div>
