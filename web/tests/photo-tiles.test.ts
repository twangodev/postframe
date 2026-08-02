import assert from 'node:assert/strict';
import test from 'node:test';

import { planPhotoTiles, tileBin, visibleImageRect } from '../src/lib/photo-tiles.ts';
import { fittedTransform } from '../src/lib/photo-viewport.ts';

const viewport = { width: 1200, height: 800 };
const image = { width: 6000, height: 4000 };

test('chooses a device-aware power-of-two tile bin', () => {
	assert.equal(tileBin(1), 1);
	assert.equal(tileBin(0.188), 4);
	assert.equal(tileBin(0.188, 2), 2);
	assert.equal(tileBin(0.001), 64);
});

test('clips the visible image rectangle at the document edges', () => {
	assert.deepEqual(visibleImageRect(viewport, image, fittedTransform(viewport, image)), {
		x: 0,
		y: 0,
		width: 6000,
		height: 4000
	});
	assert.deepEqual(visibleImageRect(viewport, image, { scale: 1, pan: { x: 2448, y: 0 } }), {
		x: 0,
		y: 1600,
		width: 1152,
		height: 800
	});
});

test('plans only the visible tiles at the appropriate resolution', () => {
	const fitted = planPhotoTiles(viewport, image, fittedTransform(viewport, image));
	assert.equal(fitted.length, 6);
	assert.ok(fitted.every((tile) => tile.bin === 4));

	const actualPixels = planPhotoTiles(viewport, image, {
		scale: 1,
		pan: { x: 0, y: 0 }
	});
	assert.equal(actualPixels.length, 8);
	assert.ok(actualPixels.every((tile) => tile.bin === 1));
	assert.ok(actualPixels.every((tile) => tile.outputWidth <= 512));
	assert.ok(actualPixels.every((tile) => tile.outputHeight <= 512));
});
