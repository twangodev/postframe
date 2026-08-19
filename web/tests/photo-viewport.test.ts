import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clampTransform,
	fitScale,
	fittedTransform,
	imageToScreen,
	maxDimension,
	normalizedLength,
	normalizedToPixel,
	pixelToNormalized,
	nextZoomScale,
	panBy,
	pixelGridOpacity,
	screenToImage,
	visibleImageRect,
	wheelNavigation,
	withinImage,
	zoomAt
} from '../src/lib/photo-viewport.ts';

const viewport = { width: 1200, height: 800 };
const image = { width: 6000, height: 4000 };

test('accepts points inside the image and on its boundary', () => {
	assert.equal(withinImage({ x: 3000, y: 2000 }, image), true);
	assert.equal(withinImage({ x: 0, y: 0 }, image), true);
	assert.equal(withinImage({ x: 6000, y: 4000 }, image), true);
});

test('rejects points outside the image', () => {
	assert.equal(withinImage({ x: -1, y: 2000 }, image), false);
	assert.equal(withinImage({ x: 3000, y: 4001 }, image), false);
});

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

test('clips the visible source rectangle at the document edges', () => {
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

test('clamps panning while retaining a small overscroll allowance', () => {
	const actual = { scale: 1, pan: { x: 0, y: 0 } };
	const panned = panBy(actual, { x: 10000, y: -10000 }, viewport, image);

	assert.deepEqual(panned.pan, { x: 2448, y: -1648 });
	assert.deepEqual(clampTransform(panned, viewport, image), panned);
});

test('maps wheel input to Photoshop-style canvas navigation', () => {
	const modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
	assert.deepEqual(wheelNavigation({ x: 0, y: 120 }, modifiers), {
		kind: 'pan',
		delta: { x: 0, y: -120 }
	});
	assert.deepEqual(wheelNavigation({ x: 36, y: 4 }, modifiers), {
		kind: 'pan',
		delta: { x: -36, y: -4 }
	});
	assert.deepEqual(wheelNavigation({ x: 0, y: 120 }, { ...modifiers, shiftKey: true }), {
		kind: 'pan',
		delta: { x: -120, y: 0 }
	});
	assert.deepEqual(wheelNavigation({ x: 0, y: 120 }, { ...modifiers, metaKey: true }), {
		kind: 'pan',
		delta: { x: -120, y: 0 }
	});
	assert.deepEqual(wheelNavigation({ x: 0, y: 120 }, { ...modifiers, altKey: true }), {
		kind: 'zoom',
		delta: 120
	});
	assert.deepEqual(wheelNavigation({ x: 0, y: -2 }, { ...modifiers, ctrlKey: true }), {
		kind: 'zoom',
		delta: -2
	});
});

test('steps through useful photographic zoom presets', () => {
	assert.equal(nextZoomScale(0.188, 1, 0.188), 0.25);
	assert.equal(nextZoomScale(1, 1, 0.188), 2);
	assert.equal(nextZoomScale(1, -1, 0.188), 0.6667);
	assert.equal(nextZoomScale(32, 1, 0.188), 32);
});

test('fades the source pixel grid in only at useful magnification', () => {
	assert.equal(pixelGridOpacity(4), 0);
	assert.equal(pixelGridOpacity(6), 0);
	assert.equal(pixelGridOpacity(7), 0.5);
	assert.equal(pixelGridOpacity(8), 1);
	assert.equal(pixelGridOpacity(32), 1);
});

test('normalized coordinates convert per axis and lengths follow the longest side', () => {
	const image = { width: 200, height: 100 };
	assert.deepEqual(normalizedToPixel({ x: 0.25, y: 0.5 }, image), { x: 50, y: 50 });
	assert.deepEqual(pixelToNormalized({ x: 50, y: 50 }, image), { x: 0.25, y: 0.5 });
	assert.deepEqual(pixelToNormalized({ x: -10, y: 130 }, image), { x: 0, y: 1 });
	assert.equal(maxDimension(image), 200);
	assert.equal(normalizedLength(0.1, image), 20);
});
