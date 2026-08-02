import type OpenSeadragon from 'openseadragon';
import type { Size } from './photo-viewport.ts';
import type { RenderTileRequest } from './worker.ts';

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
	image: Size;
	renderTile: (photoId: string, tile: RenderTileRequest) => Promise<ArrayBuffer>;
	ev: number;
	tone: boolean;
	onTileEvent?: (event: PyramidTileEvent) => void;
}

interface TileJobState {
	cancelled: boolean;
	image?: HTMLImageElement;
	objectUrl?: string;
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
		`postframe://${encodeURIComponent(options.photoId)}/${level}/${column}/${row}.png`;
	source.downloadTileStart = (job) => {
		const { level, x: column, y: row } = job.tile;
		const key = `${level}:${column}:${row}`;
		const state: TileJobState = { cancelled: false };
		job.userData.postframe = state;
		options.onTileEvent?.({ key, phase: 'rendering' });

		const region = pyramidTileRegion(options.image, levels.maxLevel, level, column, row);
		void options
			.renderTile(options.photoId, {
				x: region.x,
				y: region.y,
				width: region.width,
				height: region.height,
				bin: region.bin,
				ev: options.ev,
				tone: options.tone
			})
			.then((png) => decodeTile(png, state))
			.then((image) => {
				if (!image || state.cancelled) return;
				options.onTileEvent?.({ key, phase: 'decoded' });
				job.finish(image, null, 'image');
			})
			.catch((error: unknown) => {
				if (state.cancelled) return;
				const message = error instanceof Error ? error.message : 'Unable to render tile';
				options.onTileEvent?.({ key, phase: 'failed', message });
				job.fail(message, null);
			})
			.finally(() => releaseTileUrl(state));
	};
	source.downloadTileAbort = (job) => {
		const state = job.userData.postframe as TileJobState | undefined;
		if (!state) return;
		state.cancelled = true;
		if (state.image) state.image.src = '';
		releaseTileUrl(state);
	};

	return source;
}

async function decodeTile(png: ArrayBuffer, state: TileJobState) {
	if (state.cancelled) return null;
	const image = new Image();
	const objectUrl = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
	state.image = image;
	state.objectUrl = objectUrl;
	image.src = objectUrl;
	await image.decode();
	return state.cancelled ? null : image;
}

function releaseTileUrl(state: TileJobState) {
	if (!state.objectUrl) return;
	URL.revokeObjectURL(state.objectUrl);
	state.objectUrl = undefined;
}
