import type OpenSeadragon from 'openseadragon';
import type { Size } from './photo-viewport.ts';
import type { RenderTileRequest } from './worker.ts';
import type { DevelopSettings } from './develop-settings.ts';
import type { NormalizedCrop } from './edit-document.ts';
import type { ClippingIndicators } from './clipping.ts';

export const PYRAMID_TILE_SIZE = 512;
export const PYRAMID_TILE_OVERLAP = 1;
export const PYRAMID_MAX_BIN = 64;

export interface PyramidLevels {
	minLevel: number;
	maxLevel: number;
}

export interface PyramidTileRegion {
	x: number;
	y: number;
	width: number;
	height: number;
	bin: number;
	outputWidth: number;
	outputHeight: number;
}

export type PyramidTilePhase = 'rendering' | 'decoded' | 'failed';

export interface PyramidTileEvent {
	key: string;
	phase: PyramidTilePhase;
	message?: string;
}

interface TileSourceOptions {
	photoId: string;
	revision: number;
	image: Size;
	renderTile: (
		photoId: string,
		tile: RenderTileRequest,
		signal: AbortSignal
	) => Promise<ImageBitmap>;
	adjustments: DevelopSettings;
	crop: NormalizedCrop | null;
	tone: boolean;
	clipping?: ClippingIndicators;
	onTileEvent?: (event: PyramidTileEvent) => void;
}

export function pyramidTileUrl(
	photoId: string,
	revision: number,
	level: number,
	column: number,
	row: number
) {
	return `postframe://${encodeURIComponent(photoId)}/${revision}/${level}/${column}/${row}.bitmap`;
}

interface TileJobState {
	cancelled: boolean;
	controller: AbortController;
	bitmap?: ImageBitmap;
}

export function pyramidLevels(image: Size): PyramidLevels {
	const maxLevel = Math.ceil(Math.log2(Math.max(1, image.width, image.height)));
	return {
		maxLevel,
		minLevel: Math.max(0, maxLevel - Math.log2(PYRAMID_MAX_BIN))
	};
}

export function pyramidTileRegion(
	image: Size,
	maxLevel: number,
	level: number,
	column: number,
	row: number
): PyramidTileRegion {
	const bin = 2 ** (maxLevel - level);
	if (!Number.isSafeInteger(bin) || bin < 1 || bin > PYRAMID_MAX_BIN) {
		throw new RangeError(`Unsupported pyramid level ${level}`);
	}

	const levelWidth = Math.ceil(image.width / bin);
	const levelHeight = Math.ceil(image.height / bin);
	const outputX = column === 0 ? 0 : column * PYRAMID_TILE_SIZE - PYRAMID_TILE_OVERLAP;
	const outputY = row === 0 ? 0 : row * PYRAMID_TILE_SIZE - PYRAMID_TILE_OVERLAP;
	const outputWidth = Math.min(
		PYRAMID_TILE_SIZE + (column === 0 ? 1 : 2) * PYRAMID_TILE_OVERLAP,
		levelWidth - outputX
	);
	const outputHeight = Math.min(
		PYRAMID_TILE_SIZE + (row === 0 ? 1 : 2) * PYRAMID_TILE_OVERLAP,
		levelHeight - outputY
	);
	if (outputWidth <= 0 || outputHeight <= 0) throw new RangeError('Tile is outside the image');

	const x = outputX * bin;
	const y = outputY * bin;
	const width = Math.min(outputWidth * bin, image.width - x);
	const height = Math.min(outputHeight * bin, image.height - y);
	return {
		x,
		y,
		width,
		height,
		bin,
		outputWidth: Math.ceil(width / bin),
		outputHeight: Math.ceil(height / bin)
	};
}

export function createPostframeTileSource(
	openSeadragon: typeof OpenSeadragon,
	options: TileSourceOptions
): OpenSeadragon.TileSource {
	const levels = pyramidLevels(options.image);
	const source = new openSeadragon.TileSource({
		width: options.image.width,
		height: options.image.height,
		tileSize: PYRAMID_TILE_SIZE,
		tileOverlap: PYRAMID_TILE_OVERLAP,
		minLevel: levels.minLevel,
		maxLevel: levels.maxLevel
	});

	source.getTileUrl = (level, column, row) =>
		pyramidTileUrl(options.photoId, options.revision, level, column, row);
	source.downloadTileStart = (job) => {
		const { level, x: column, y: row } = job.tile;
		const key = `${options.revision}:${level}:${column}:${row}`;
		const state: TileJobState = { cancelled: false, controller: new AbortController() };
		job.userData.postframe = state;
		options.onTileEvent?.({ key, phase: 'rendering' });

		const region = pyramidTileRegion(options.image, levels.maxLevel, level, column, row);
		void options
			.renderTile(
				options.photoId,
				{
					x: region.x,
					y: region.y,
					width: region.width,
					height: region.height,
					bin: region.bin,
					adjustments: options.adjustments,
					crop: options.crop,
					tone: options.tone,
					...(options.clipping ? { clipping: options.clipping } : {})
				},
				state.controller.signal
			)
			.then((bitmap) => {
				state.bitmap = bitmap;
				if (state.cancelled) {
					bitmap.close();
					return;
				}
				options.onTileEvent?.({ key, phase: 'decoded' });
				job.finish(bitmap, null, 'imageBitmap');
			})
			.catch((error: unknown) => {
				if (state.cancelled) return;
				const message = error instanceof Error ? error.message : 'Unable to render tile';
				options.onTileEvent?.({ key, phase: 'failed', message });
				job.fail(message, null);
			})
			.finally(() => {
				state.bitmap = undefined;
			});
	};
	source.downloadTileAbort = (job) => {
		const state = job.userData.postframe as TileJobState | undefined;
		if (!state) return;
		state.cancelled = true;
		state.controller.abort();
		state.bitmap?.close();
		state.bitmap = undefined;
	};

	return source;
}
