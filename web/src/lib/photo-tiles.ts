import { screenToImage, type Size, type ViewportTransform } from './photo-viewport.ts';

export interface ImageRect extends Size {
	x: number;
	y: number;
}

export interface PhotoTile extends ImageRect {
	key: string;
	bin: number;
	outputWidth: number;
	outputHeight: number;
}

export const TILE_OUTPUT_SIZE = 512;
export const MAX_TILE_BIN = 64;

export function tileBin(scale: number, pixelRatio = 1) {
	const sourcePixelsPerDisplayPixel = 1 / Math.max(Number.EPSILON, scale * pixelRatio);
	let bin = 1;
	while (bin * 2 <= sourcePixelsPerDisplayPixel && bin < MAX_TILE_BIN) bin *= 2;
	return bin;
}

export function visibleImageRect(
	viewport: Size,
	image: Size,
	transform: ViewportTransform
): ImageRect {
	const start = screenToImage({ x: 0, y: 0 }, viewport, image, transform);
	const end = screenToImage({ x: viewport.width, y: viewport.height }, viewport, image, transform);
	const x = clamp(start.x, 0, image.width);
	const y = clamp(start.y, 0, image.height);
	const right = clamp(end.x, 0, image.width);
	const bottom = clamp(end.y, 0, image.height);
	return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function planPhotoTiles(
	viewport: Size,
	image: Size,
	transform: ViewportTransform,
	pixelRatio = 1
) {
	const visible = visibleImageRect(viewport, image, transform);
	if (visible.width === 0 || visible.height === 0) return [];

	const bin = tileBin(transform.scale, pixelRatio);
	const sourceTileSize = TILE_OUTPUT_SIZE * bin;
	const firstColumn = Math.floor(visible.x / sourceTileSize);
	const lastColumn = Math.ceil((visible.x + visible.width) / sourceTileSize) - 1;
	const firstRow = Math.floor(visible.y / sourceTileSize);
	const lastRow = Math.ceil((visible.y + visible.height) / sourceTileSize) - 1;
	const center = { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 };
	const tiles: PhotoTile[] = [];

	for (let row = firstRow; row <= lastRow; row += 1) {
		for (let column = firstColumn; column <= lastColumn; column += 1) {
			const x = column * sourceTileSize;
			const y = row * sourceTileSize;
			const width = Math.min(sourceTileSize, image.width - x);
			const height = Math.min(sourceTileSize, image.height - y);
			tiles.push({
				key: `${bin}:${x}:${y}:${width}:${height}`,
				x,
				y,
				width,
				height,
				bin,
				outputWidth: Math.ceil(width / bin),
				outputHeight: Math.ceil(height / bin)
			});
		}
	}

	return tiles.sort((first, second) => tileDistance(first, center) - tileDistance(second, center));
}

function tileDistance(tile: PhotoTile, point: { x: number; y: number }) {
	return Math.hypot(tile.x + tile.width / 2 - point.x, tile.y + tile.height / 2 - point.y);
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
