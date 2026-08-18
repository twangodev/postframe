import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clippedEnds,
	CLIPPING_KINDS,
	HIGHLIGHT_CLIPPING_COLOR,
	paintClipping,
	SHADOW_CLIPPING_COLOR,
	showsClipping
} from '../src/lib/clipping.ts';
import { HISTOGRAM_BINS, HISTOGRAM_CHANNELS } from '../src/lib/image-scope.ts';

const pixels = () =>
	new Uint8Array([
		...[255, 128, 0, 255],
		...[0, 0, 0, 200],
		...[255, 255, 255, 255],
		...[128, 128, 128, 90],
		...[254, 1, 3, 255]
	]);

test('paints nothing while both indicators are off', () => {
	const rgba = pixels();
	paintClipping(rgba, { highlights: false, shadows: false });
	assert.deepEqual(rgba, pixels());
});

test('highlights paint pixels with any channel at 255 and leave alpha alone', () => {
	const rgba = pixels();
	paintClipping(rgba, { highlights: true, shadows: false });
	assert.deepEqual(
		[...rgba],
		[
			...HIGHLIGHT_CLIPPING_COLOR,
			255,
			...[0, 0, 0, 200],
			...HIGHLIGHT_CLIPPING_COLOR,
			255,
			...[128, 128, 128, 90],
			...[254, 1, 3, 255]
		]
	);
});

test('shadows paint pixels with any channel at 0 and leave alpha alone', () => {
	const rgba = pixels();
	paintClipping(rgba, { highlights: false, shadows: true });
	assert.deepEqual(
		[...rgba],
		[
			...SHADOW_CLIPPING_COLOR,
			255,
			...SHADOW_CLIPPING_COLOR,
			200,
			...[255, 255, 255, 255],
			...[128, 128, 128, 90],
			...[254, 1, 3, 255]
		]
	);
});

test('highlights win where a pixel clips at both ends', () => {
	const rgba = pixels();
	paintClipping(rgba, { highlights: true, shadows: true });
	assert.deepEqual([...rgba.subarray(0, 3)], [...HIGHLIGHT_CLIPPING_COLOR]);
	assert.deepEqual([...rgba.subarray(4, 7)], [...SHADOW_CLIPPING_COLOR]);
	assert.deepEqual([...rgba.subarray(8, 11)], [...HIGHLIGHT_CLIPPING_COLOR]);
	assert.deepEqual([...rgba.subarray(12, 16)], [128, 128, 128, 90]);
});

test('clamped arrays paint the same way', () => {
	const rgba = new Uint8ClampedArray(pixels());
	paintClipping(rgba, { highlights: true, shadows: true });
	assert.deepEqual([...rgba.subarray(0, 4)], [...HIGHLIGHT_CLIPPING_COLOR, 255]);
});

test('the histogram ends say which indicators have something to show', () => {
	const histogram = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	assert.deepEqual(clippedEnds(histogram), { highlights: false, shadows: false });
	histogram[2 * HISTOGRAM_BINS] = 3;
	assert.deepEqual(clippedEnds(histogram), { highlights: false, shadows: true });
	histogram[HISTOGRAM_BINS - 1] = 1;
	assert.deepEqual(clippedEnds(histogram), { highlights: true, shadows: true });
	const lumaOnly = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	lumaOnly[3 * HISTOGRAM_BINS] = 5;
	lumaOnly[3 * HISTOGRAM_BINS + HISTOGRAM_BINS - 1] = 5;
	assert.deepEqual(clippedEnds(lumaOnly), { highlights: false, shadows: false });
});

test('an indicator set shows clipping when either kind is on', () => {
	assert.equal(showsClipping({ highlights: false, shadows: false }), false);
	for (const kind of CLIPPING_KINDS) {
		assert.equal(showsClipping({ highlights: false, shadows: false, [kind]: true }), true);
	}
	assert.deepEqual([...CLIPPING_KINDS].sort(), ['highlights', 'shadows']);
});
