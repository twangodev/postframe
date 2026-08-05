import assert from 'node:assert/strict';
import test from 'node:test';

import { UNKNOWN_TRIMAP_VALUE } from '../src/lib/mask-refinement.ts';
import { refineRgbBoundary } from '../src/lib/mask-edge-refiner.ts';

test('locks an uncertain boundary onto an equal-luminance color edge', () => {
	const width = 9;
	const height = 5;
	const image = new Uint8Array(width * height * 3);
	const alpha = new Uint8Array(width * height);
	const trimap = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = (y * width + x) * 3;
			if (x < 4) image.set([255, 0, 0], pixel);
			else image.set([0, 130, 0], pixel);
			const index = y * width + x;
			if (x < 3) {
				alpha[index] = 0;
				trimap[index] = 0;
			} else if (x > 4) {
				alpha[index] = 255;
				trimap[index] = 255;
			} else {
				alpha[index] = 128;
				trimap[index] = UNKNOWN_TRIMAP_VALUE;
			}
		}
	}

	const refined = refineRgbBoundary(
		{ data: image, width, height, channels: 3 },
		alpha,
		trimap,
		{ x: 0, y: 0, width, height },
		2
	);

	for (let y = 0; y < height; y += 1) {
		assert.ok(refined[y * width + 3]! < 96);
		assert.ok(refined[y * width + 4]! > 159);
	}
});
