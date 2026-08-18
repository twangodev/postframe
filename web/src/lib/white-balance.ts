import type { NormalizedPoint } from './edit-document.ts';

/** How far around the picked point the eyedropper reads, in source-image pixels. */
export const EYEDROPPER_SAMPLE_RADIUS = 5;

export interface SampledImage {
	width: number;
	height: number;
	rgba: Uint8ClampedArray | Uint8Array;
}

export type EncodedColor = [red: number, green: number, blue: number];

/**
 * The mean encoded colour (0..1) of the opaque pixels within `radius` of the
 * point, the disc clipped to the image; a radius of one reads the centre alone.
 */
export function sampleDisc(
	image: SampledImage,
	point: NormalizedPoint,
	radius: number
): EncodedColor {
	const reach = Math.max(1, radius);
	const centreX = clampIndex(Math.floor(point.x * image.width), image.width);
	const centreY = clampIndex(Math.floor(point.y * image.height), image.height);
	const span = Math.ceil(reach) - 1;
	const sum = [0, 0, 0];
	let count = 0;
	for (let dy = -span; dy <= span; dy += 1) {
		const y = centreY + dy;
		if (y < 0 || y >= image.height) continue;
		for (let dx = -span; dx <= span; dx += 1) {
			const x = centreX + dx;
			if (x < 0 || x >= image.width || dx * dx + dy * dy >= reach * reach) continue;
			const offset = (y * image.width + x) * 4;
			if (image.rgba[offset + 3] === 0) continue;
			sum[0] += image.rgba[offset] ?? 0;
			sum[1] += image.rgba[offset + 1] ?? 0;
			sum[2] += image.rgba[offset + 2] ?? 0;
			count += 1;
		}
	}
	if (count === 0) return [0, 0, 0];
	return [sum[0] / count / 255, sum[1] / count / 255, sum[2] / count / 255];
}

function clampIndex(index: number, size: number) {
	return Math.min(size - 1, Math.max(0, index));
}
