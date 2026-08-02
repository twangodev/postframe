import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clampTransform,
	fitScale,
	fittedTransform,
	imageToScreen,
	nextZoomScale,
	panBy,
	screenToImage,
	zoomAt
} from '../src/lib/photo-viewport.ts';

const viewport = { width: 1200, height: 800 };
const image = { width: 6000, height: 4000 };

test('fits a photo inside the padded viewport without upscaling', () => {
	assert.equal(fitScale(viewport, image), 0.188);
	assert.equal(fitScale(viewport, { width: 640, height: 480 }), 1);
});

test('keeps the source pixel beneath the cursor fixed while zooming', () => {
	const original = fittedTransform(viewport, image);
	const anchor = { x: 910, y: 225 };
	const sourceBefore = screenToImage(anchor, viewport, image, original);
	const zoomed = zoomAt(original, 1, anchor, viewport, image);
	const sourceAfter = screenToImage(anchor, viewport, image, zoomed);

	assert.ok(Math.abs(sourceAfter.x - sourceBefore.x) < 1e-9);
	assert.ok(Math.abs(sourceAfter.y - sourceBefore.y) < 1e-9);
	const screenAfter = imageToScreen(sourceAfter, viewport, image, zoomed);
	assert.ok(Math.abs(screenAfter.x - anchor.x) < 1e-9);
	assert.ok(Math.abs(screenAfter.y - anchor.y) < 1e-9);
});

test('clamps panning while retaining a small overscroll allowance', () => {
	const actual = { scale: 1, pan: { x: 0, y: 0 } };
	const panned = panBy(actual, { x: 10000, y: -10000 }, viewport, image);

	assert.deepEqual(panned.pan, { x: 2448, y: -1648 });
	assert.deepEqual(clampTransform(panned, viewport, image), panned);
});

test('steps through useful photographic zoom presets', () => {
	assert.equal(nextZoomScale(0.188, 1, 0.188), 0.25);
	assert.equal(nextZoomScale(1, 1, 0.188), 2);
	assert.equal(nextZoomScale(1, -1, 0.188), 0.6667);
	assert.equal(nextZoomScale(32, 1, 0.188), 32);
});
