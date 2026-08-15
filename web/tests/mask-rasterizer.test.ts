import assert from 'node:assert/strict';
import test from 'node:test';

import {
	rasterizeBrushStrokes,
	rasterizeLinearGradient,
	rasterizeRadialGradient
} from '../src/lib/mask-rasterizer.ts';

const point = (x: number, y: number) => ({ x, y });

test('stamps a hard brush dab sized against the longest dimension', () => {
	const alpha = rasterizeBrushStrokes(
		[{ points: [point(0.5, 0.5)], size: 0.8, feather: 0, flow: 1 }],
		5,
		5
	);
	assert.deepEqual(
		alpha,
		Uint8Array.from([
			...[0, 0, 0, 0, 0],
			...[0, 255, 255, 255, 0],
			...[0, 255, 255, 255, 0],
			...[0, 255, 255, 255, 0],
			...[0, 0, 0, 0, 0]
		])
	);
});

test('feathers a dab linearly from its core to its edge', () => {
	const alpha = rasterizeBrushStrokes(
		[{ points: [point(0.5, 0.5)], size: 0.8, feather: 1, flow: 1 }],
		5,
		1
	);
	assert.deepEqual(alpha, Uint8Array.from([0, 128, 255, 128, 0]));
});

test('accumulates flow across strokes and saturates at full opacity', () => {
	const stroke = (flow: number) => ({ points: [point(0.5, 0.5)], size: 1, feather: 0, flow });
	assert.deepEqual(rasterizeBrushStrokes([stroke(0.25)], 1, 1), Uint8Array.of(64));
	assert.deepEqual(rasterizeBrushStrokes([stroke(0.25), stroke(0.25)], 1, 1), Uint8Array.of(128));
	assert.deepEqual(rasterizeBrushStrokes([stroke(1), stroke(1)], 1, 1), Uint8Array.of(255));
});

test('stamps continuously along a stroke path', () => {
	const alpha = rasterizeBrushStrokes(
		[{ points: [point(0.25, 0.5), point(0.75, 0.5)], size: 0.25, feather: 0, flow: 1 }],
		8,
		1
	);
	assert.deepEqual(alpha, Uint8Array.from([0, 255, 255, 255, 255, 255, 255, 0]));
});

test('clips brush dabs at the raster bounds', () => {
	const alpha = rasterizeBrushStrokes(
		[{ points: [point(0, 0.5)], size: 1, feather: 0, flow: 1 }],
		4,
		1
	);
	assert.deepEqual(alpha, Uint8Array.from([255, 255, 0, 0]));
});

test('ramps a linear gradient from its start to its end', () => {
	assert.deepEqual(
		rasterizeLinearGradient({ start: point(0.25, 0.5), end: point(0.75, 0.5) }, 4, 1),
		Uint8Array.from([0, 64, 191, 255])
	);
	assert.deepEqual(
		rasterizeLinearGradient({ start: point(0.75, 0.5), end: point(0.25, 0.5) }, 4, 1),
		Uint8Array.from([255, 191, 64, 0])
	);
});

test('ramps a vertical gradient uniformly across each row', () => {
	assert.deepEqual(
		rasterizeLinearGradient({ start: point(0.5, 0), end: point(0.5, 1) }, 2, 4),
		Uint8Array.from([32, 32, 96, 96, 159, 159, 223, 223])
	);
});

test('leaves a degenerate linear gradient empty', () => {
	assert.deepEqual(
		rasterizeLinearGradient({ start: point(0.5, 0.5), end: point(0.5, 0.5) }, 2, 2),
		Uint8Array.from([0, 0, 0, 0])
	);
});

test('fills a hard radial gradient inside its radius', () => {
	assert.deepEqual(
		rasterizeRadialGradient({ center: point(0.5, 0.5), radius: 0.4, feather: 0 }, 5, 5),
		Uint8Array.from([
			...[0, 0, 0, 0, 0],
			...[0, 255, 255, 255, 0],
			...[0, 255, 255, 255, 0],
			...[0, 255, 255, 255, 0],
			...[0, 0, 0, 0, 0]
		])
	);
});

test('feathers a radial gradient from its core to its edge', () => {
	assert.deepEqual(
		rasterizeRadialGradient({ center: point(0.5, 0.5), radius: 4 / 9, feather: 0.5 }, 9, 1),
		Uint8Array.from([0, 128, 255, 255, 255, 255, 255, 128, 0])
	);
});

test('measures the radial radius against the longest dimension', () => {
	assert.deepEqual(
		rasterizeRadialGradient({ center: point(0.5, 0.5), radius: 1 / 3, feather: 0 }, 2, 6),
		Uint8Array.from([0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0])
	);
});
