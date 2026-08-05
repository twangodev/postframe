import assert from 'node:assert/strict';
import test from 'node:test';

import {
	UNKNOWN_TRIMAP_VALUE,
	mergeRefinedAlpha,
	placeMaskRegion,
	prepareMatteRegion,
	trimapFromAlpha
} from '../src/lib/mask-refinement.ts';

test('turns uncertain confidence and both sides of a boundary into a trimap band', () => {
	const alpha = new Uint8Array([
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 255, 160, 255, 0, 0,
		0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
	]);
	const trimap = trimapFromAlpha(alpha, 7, 7, 1);

	assert.equal(trimap[0], 0);
	assert.equal(trimap[3 * 7 + 3], UNKNOWN_TRIMAP_VALUE);
	assert.equal(trimap[1 * 7 + 3], UNKNOWN_TRIMAP_VALUE);
	assert.equal(trimap[2 * 7 + 3], UNKNOWN_TRIMAP_VALUE);
});

test('extracts a padded region around the selected object', () => {
	const alpha = new Uint8Array(20 * 10);
	for (let y = 4; y <= 5; y += 1) {
		for (let x = 9; x <= 10; x += 1) alpha[y * 20 + x] = 255;
	}
	const region = prepareMatteRegion(alpha, 20, 10, 1);

	assert.deepEqual(region?.bounds, { x: 6, y: 1, width: 8, height: 8 });
	assert.equal(region?.trimap.length, 64);
});

test('keeps known trimap pixels and uses the matte only in the unknown band', () => {
	const trimap = new Uint8Array([0, UNKNOWN_TRIMAP_VALUE, 255]);
	const matte = new Uint8Array([200, 137, 12]);

	assert.deepEqual(mergeRefinedAlpha(trimap, matte, 3, 1), new Uint8Array([0, 137, 255]));
});

test('places a refined crop into the full transparent mask', () => {
	const placed = placeMaskRegion(
		new Uint8Array([1, 2, 3, 4]),
		{ x: 1, y: 1, width: 2, height: 2 },
		4,
		4
	);

	assert.deepEqual(placed, new Uint8Array([0, 0, 0, 0, 0, 1, 2, 0, 0, 3, 4, 0, 0, 0, 0, 0]));
});
