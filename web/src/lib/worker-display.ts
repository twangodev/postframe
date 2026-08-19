import type { WasmDisplayTransform } from './wasm-runtime';

export interface DisplayRegion {
	x: number;
	y: number;
	width: number;
	height: number;
	bin: number;
}

export interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ImageSize {
	width: number;
	height: number;
}

export function canvasContext(width: number, height: number, willReadFrequently = true) {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { willReadFrequently });
	if (!context) throw new Error('Unable to create an image canvas');
	return context;
}

export function imageData(pixels: Uint8Array, width: number, height: number) {
	return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

// Pads the source rect (clamped to image) so spatial stages see neighbourhood context; crop locates the tile within it.
export function apronRegion(region: DisplayRegion, apron: number, image: ImageSize) {
	const pad = apron * region.bin;
	const x = Math.max(0, region.x - pad);
	const y = Math.max(0, region.y - pad);
	const source: DisplayRegion = {
		x,
		y,
		width: Math.min(image.width, region.x + region.width + pad) - x,
		height: Math.min(image.height, region.y + region.height + pad) - y,
		bin: region.bin
	};
	const crop: PixelRect = {
		x: (region.x - x) / region.bin,
		y: (region.y - y) / region.bin,
		width: Math.ceil(region.width / region.bin),
		height: Math.ceil(region.height / region.bin)
	};
	return { source, crop };
}

export function cropRgba(rgba: Uint8Array | Uint8ClampedArray, stride: number, crop: PixelRect) {
	const cropped = new Uint8ClampedArray(crop.width * crop.height * 4);
	for (let row = 0; row < crop.height; row += 1) {
		const start = ((crop.y + row) * stride + crop.x) * 4;
		cropped.set(rgba.subarray(start, start + crop.width * 4), row * crop.width * 4);
	}
	return cropped;
}

export function developDisplayRegion(
	bitmap: ImageBitmap,
	transform: WasmDisplayTransform,
	region: DisplayRegion,
	image: ImageSize
) {
	const apron = transform.detail_apron(image.width, image.height, region.bin);
	const { source, crop } = apronRegion(region, apron, image);
	const width = Math.ceil(source.width / source.bin);
	const height = Math.ceil(source.height / source.bin);
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = source.bin > 1;
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
	const pixels = context.getImageData(0, 0, width, height);
	const developed = transform.apply_tile_rgba(
		new Uint8Array(pixels.data.buffer),
		width,
		height,
		{
			imageWidth: image.width,
			imageHeight: image.height,
			x: source.x,
			y: source.y,
			width: source.width,
			height: source.height
		},
		source.bin
	);
	return new ImageData(cropRgba(developed, width, crop), crop.width, crop.height);
}
