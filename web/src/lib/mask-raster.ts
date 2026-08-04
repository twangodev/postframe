import type { MaskOperation } from './edit-document.ts';

export interface MaskRasterData {
	width: number;
	height: number;
	alpha: Uint8Array;
}

export interface MaskRasterLayer {
	operation: MaskOperation;
	inverted?: boolean;
	raster: MaskRasterData;
}

export function composeMaskRasters(layers: readonly MaskRasterLayer[]): MaskRasterData | null {
	const first = layers[0];
	if (!first) return null;
	validateMaskRaster(first.raster);
	const composed = new Uint8Array(first.raster.width * first.raster.height);

	for (const layer of layers) {
		validateMaskRaster(layer.raster);
		for (let y = 0; y < first.raster.height; y += 1) {
			for (let x = 0; x < first.raster.width; x += 1) {
				const index = y * first.raster.width + x;
				const sampled = sampleMask(layer.raster, x, y, first.raster.width, first.raster.height);
				const alpha = layer.inverted ? 255 - sampled : sampled;
				composed[index] = combineAlpha(composed[index] ?? 0, alpha, layer.operation);
			}
		}
	}

	return { width: first.raster.width, height: first.raster.height, alpha: composed };
}

export function alphaChannel(image: {
	width: number;
	height: number;
	channels: number;
	data: Uint8Array | Uint8ClampedArray;
}): Uint8Array {
	if (image.channels !== 4 || image.data.length !== image.width * image.height * 4) {
		throw new Error('Expected an RGBA image');
	}
	const alpha = new Uint8Array(image.width * image.height);
	for (let index = 0; index < alpha.length; index += 1) alpha[index] = image.data[index * 4 + 3]!;
	return alpha;
}

export async function maskDigest(alpha: Uint8Array) {
	const bytes = new Uint8Array(alpha.length);
	bytes.set(alpha);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateMaskRaster(raster: MaskRasterData) {
	if (
		!Number.isSafeInteger(raster.width) ||
		!Number.isSafeInteger(raster.height) ||
		raster.width <= 0 ||
		raster.height <= 0 ||
		raster.alpha.length !== raster.width * raster.height
	) {
		throw new Error('Mask dimensions do not match its pixels');
	}
}

function combineAlpha(current: number, next: number, operation: MaskOperation) {
	switch (operation) {
		case 'add':
			return Math.max(current, next);
		case 'subtract':
			return Math.round((current * (255 - next)) / 255);
		case 'intersect':
			return Math.round((current * next) / 255);
	}
}

function sampleMask(
	raster: MaskRasterData,
	x: number,
	y: number,
	targetWidth: number,
	targetHeight: number
) {
	if (raster.width === targetWidth && raster.height === targetHeight) {
		return raster.alpha[y * targetWidth + x] ?? 0;
	}
	const sourceX = Math.min(raster.width - 1, Math.floor(((x + 0.5) * raster.width) / targetWidth));
	const sourceY = Math.min(
		raster.height - 1,
		Math.floor(((y + 0.5) * raster.height) / targetHeight)
	);
	return raster.alpha[sourceY * raster.width + sourceX] ?? 0;
}
