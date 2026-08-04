import assert from 'node:assert/strict';
import test from 'node:test';

import { alphaChannel, composeMaskRasters, maskDigest } from '../src/lib/mask-raster.ts';

test('combines ordered mask components and supports inversion', () => {
	const raster = (alpha: number[]) => ({ width: 2, height: 1, alpha: Uint8Array.from(alpha) });
	const composed = composeMaskRasters([
		{ operation: 'add', raster: raster([255, 64]) },
		{ operation: 'subtract', raster: raster([128, 0]) },
		{ operation: 'add', inverted: true, raster: raster([255, 0]) }
	]);

	assert.deepEqual(composed?.alpha, Uint8Array.from([127, 255]));
});

test('normalizes component dimensions to the first raster', () => {
	const composed = composeMaskRasters([
		{ operation: 'add', raster: { width: 2, height: 1, alpha: Uint8Array.from([0, 255]) } },
		{ operation: 'intersect', raster: { width: 1, height: 1, alpha: Uint8Array.of(128) } }
	]);
	assert.deepEqual(composed?.alpha, Uint8Array.from([0, 128]));
});

test('extracts model alpha and hashes persistent mask bytes', async () => {
	const alpha = alphaChannel({
		width: 2,
		height: 1,
		channels: 4,
		data: Uint8Array.from([10, 20, 30, 64, 40, 50, 60, 255])
	});
	assert.deepEqual(alpha, Uint8Array.from([64, 255]));
	assert.equal(
		await maskDigest(alpha),
		'5f5df442506eba39ecaf964bc81b19c6727f39726cd676d7e5922359a5613626'
	);
});
