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
	import type { DevelopSettings } from '$lib/develop-settings';
	import type { NormalizedCrop } from '$lib/edit-document';

	interface Props {
		photoId: string;
		enabled: boolean;
		viewport: Size;
		image: Size;
		transform: ViewportTransform;
		renderTile: (
			photoId: string,
			tile: RenderTileRequest,
			signal: AbortSignal
		) => Promise<ImageBitmap>;
		renderRevision: number;
		onRenderSettled?: (revision: number) => void;
		adjustments: DevelopSettings;
		crop: NormalizedCrop | null;
		tone?: boolean;
	}

	interface Diagnostics {
		rendering: number;
		decoded: number;
		failed: number;
		fullyLoaded: boolean;
	}

	interface TileReplacement {
		item: OpenSeadragon.TiledImage;
		previous: OpenSeadragon.TiledImage | null;
		generation: number;
		revision: number;
		exposed: boolean;
		drawn: boolean;
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
		onRenderSettled = () => {},
		adjustments,
		crop,
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
	let replacement: TileReplacement | null = null;
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
				imageLoaderLimit: 2,
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
				replacement = null;
				resizedViewport = null;
				imageSmoothingEnabled = null;
				opened = true;
			});
			viewer.addHandler('fully-loaded-change', (event) => {
				diagnostics = { ...diagnostics, fullyLoaded: event.fullyLoaded };
			});
			viewer.addHandler('tile-loaded', (event) => exposeReplacement(event.tiledImage));
			viewer.addHandler('update-viewport', presentExposedReplacement);
			viewer.addHandler('tile-load-failed', (event) => {
				console.warn(`Tile ${event.tile.toString()} failed: ${event.message}`);
				const failed = event as typeof event & { maxReached?: boolean };
				if (failed.maxReached !== false) rollbackReplacement(event.tiledImage);
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
			replacement = null;
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
			replacement = null;
			opened = false;
			resetDiagnostics();
			viewer.open({ tileSource: tileSource(renderRevision, adjustments, crop, tone) });
			return;
		}

		if (!opened || renderedRevision === renderRevision) return;
		renderedRevision = renderRevision;
		queueReplacement(renderRevision, adjustments, crop, tone);
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

	function tileSource(
		revision: number,
		settings: DevelopSettings,
		frame: NormalizedCrop | null,
		toneMapping: boolean
	) {
		return createPostframeTileSource(openSeadragon!, {
			photoId,
			revision,
			image,
			renderTile,
			adjustments: settings,
			crop: frame,
			tone: toneMapping,
			onTileEvent: handleTileEvent
		});
	}

	function queueReplacement(
		revision: number,
		settings: DevelopSettings,
		frame: NormalizedCrop | null,
		toneMapping: boolean
	) {
		if (!viewer) return;
		const nextGeneration = ++generation;
		discardReplacement();
		resetDiagnostics();

		viewer.addTiledImage({
			tileSource: tileSource(revision, settings, frame, toneMapping),
			opacity: 0,
			preload: true,
			success: (event) => {
				const item = (event as unknown as { item: OpenSeadragon.TiledImage }).item;
				if (!viewer || nextGeneration !== generation) {
					viewer?.world.removeItem(item);
					return;
				}
				replacement = {
					item,
					previous: activeItem,
					generation: nextGeneration,
					revision,
					exposed: false,
					drawn: false,
					fullyLoaded: item.getFullyLoaded()
				};
				item.addHandler('fully-loaded-change', (loaded) => {
					if (loaded.fullyLoaded) markReplacementFullyLoaded(item, nextGeneration);
				});
				if (item.getFullyLoaded()) exposeReplacement(item);
			}
		});
	}

	function exposeReplacement(item: OpenSeadragon.TiledImage) {
		const next = replacement;
		if (!viewer || !next || next.item !== item || next.generation !== generation || next.exposed) {
			return;
		}
		next.exposed = true;
		item.setOpacity(1);
		viewer.forceRedraw();
	}

	function presentExposedReplacement() {
		const next = replacement;
		if (!viewer || !next || !next.exposed) return;
		if (!next.drawn) {
			next.drawn = true;
			onRenderSettled(next.revision);
		}
		if (next.fullyLoaded) finishReplacement(next);
	}

	function markReplacementFullyLoaded(item: OpenSeadragon.TiledImage, itemGeneration: number) {
		const next = replacement;
		if (!next || next.item !== item || next.generation !== itemGeneration) return;
		next.fullyLoaded = true;
		exposeReplacement(item);
		viewer?.forceRedraw();
	}

	function finishReplacement(next: TileReplacement) {
		if (!viewer || replacement !== next || next.generation !== generation) return;
		activeItem = next.item;
		replacement = null;
		if (next.previous && viewer.world.getIndexOfItem(next.previous) >= 0) {
			viewer.world.removeItem(next.previous);
		}
	}

	function rollbackReplacement(item: OpenSeadragon.TiledImage) {
		const next = replacement;
		if (!viewer || !next || next.item !== item || next.generation !== generation) return;
		replacement = null;
		if (viewer.world.getIndexOfItem(item) >= 0) viewer.world.removeItem(item);
		onRenderSettled(next.revision);
	}

	function discardReplacement() {
		if (!viewer || !replacement) return;
		const item = replacement.item;
		replacement = null;
		if (viewer.world.getIndexOfItem(item) >= 0) viewer.world.removeItem(item);
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
			class="absolute bottom-3 left-3 rounded border border-subtle bg-bg/85 px-2 py-1 font-mono text-[10px] text-muted shadow-lg backdrop-blur"
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
