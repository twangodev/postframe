import assert from 'node:assert/strict';
import test from 'node:test';

import { linearGeometryFromSpan } from './gizmo-fixtures.ts';
import {
	paintRasterDimensions,
	rasterizeBrushStrokes,
	rasterizeLinearGradient,
	rasterizeRadialGradient,
	rasterizeStrokeOnto,
	stampCenters
} from '../src/lib/mask-rasterizer.ts';

const point = (x: number, y: number) => ({ x, y });

test('caps paint raster dimensions at the maximum edge', () => {
	assert.deepEqual(paintRasterDimensions(8736, 5856), { width: 2048, height: 1373 });
	assert.deepEqual(paintRasterDimensions(5856, 8736), { width: 1373, height: 2048 });
});

test('keeps paint raster dimensions below the cap untouched', () => {
	assert.deepEqual(paintRasterDimensions(1600, 900), { width: 1600, height: 900 });
});

test('clamps extreme aspect ratios to at least one pixel per edge', () => {
	assert.deepEqual(paintRasterDimensions(10000, 2), { width: 2048, height: 1 });
});

test('stamping strokes one at a time matches full re-rasterization', () => {
	const strokes = [
		{ points: [point(0.2, 0.3), point(0.7, 0.4)], size: 0.3, feather: 0.5, flow: 0.6 },
		{
			points: [point(0.5, 0.5), point(0.4, 0.8), point(0.8, 0.7)],
			size: 0.4,
			feather: 0.3,
			flow: 0.8
		},
		{ points: [point(0.6, 0.35)], size: 0.5, feather: 1, flow: 0.5 }
	];
	const full = rasterizeBrushStrokes(strokes, 64, 48);
	assert.deepEqual(
		strokes.reduce<Uint8Array>(
			(alpha, stroke) => rasterizeStrokeOnto(alpha, stroke, 64, 48),
			new Uint8Array(64 * 48)
		),
		full
	);
	assert.deepEqual(
		rasterizeStrokeOnto(
			rasterizeBrushStrokes(strokes.slice(0, -1), 64, 48),
			strokes.at(-1)!,
			64,
			48
		),
		full
	);
});

test('stamps a single point once at its pixel position', () => {
	assert.deepEqual(stampCenters([point(0.5, 0.5)], 10, 10, 2), [{ x: 5, y: 5 }]);
});

test('spaces stamps at exact intervals along a straight segment', () => {
	assert.deepEqual(
		stampCenters([point(0.25, 0.5), point(0.75, 0.5)], 16, 1, 2),
		[4, 6, 8, 10, 12].map((x) => ({ x, y: 0.5 }))
	);
});

test('carries stamp spacing across polyline vertices', () => {
	assert.deepEqual(stampCenters([point(0, 0), point(0.375, 0), point(0.375, 0.5)], 8, 8, 4), [
		{ x: 0, y: 0 },
		{ x: 3, y: 1 }
	]);
});

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
		rasterizeLinearGradient(
			linearGeometryFromSpan(point(0.25, 0.5), point(0.75, 0.5), { width: 4, height: 1 }),
			4,
			1
		),
		Uint8Array.from([0, 64, 191, 255])
	);
	assert.deepEqual(
		rasterizeLinearGradient(
			linearGeometryFromSpan(point(0.75, 0.5), point(0.25, 0.5), { width: 4, height: 1 }),
			4,
			1
		),
		Uint8Array.from([255, 191, 64, 0])
	);
});

test('ramps a vertical gradient uniformly across each row', () => {
	assert.deepEqual(
		rasterizeLinearGradient(
			linearGeometryFromSpan(point(0.5, 0), point(0.5, 1), { width: 2, height: 4 }),
			2,
			4
		),
		Uint8Array.from([32, 32, 96, 96, 159, 159, 223, 223])
	);
});

test('clamps a degenerate linear gradient to a hard edge at its anchor', () => {
	assert.deepEqual(
		rasterizeLinearGradient(
			linearGeometryFromSpan(point(0.5, 0.5), point(0.5, 0.5), { width: 2, height: 2 }),
			2,
			2
		),
		Uint8Array.from([0, 255, 0, 255])
	);
});

test('fills a hard radial gradient inside its radius', () => {
	assert.deepEqual(
		rasterizeRadialGradient(
			{ center: point(0.5, 0.5), radiusX: 0.4, radiusY: 0.4, rotation: 0, feather: 0 },
			5,
			5
		),
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
		rasterizeRadialGradient(
			{ center: point(0.5, 0.5), radiusX: 4 / 9, radiusY: 4 / 9, rotation: 0, feather: 0.5 },
			9,
			1
		),
		Uint8Array.from([0, 128, 255, 255, 255, 255, 255, 128, 0])
	);
});

test('measures the radial radius against the longest dimension', () => {
	assert.deepEqual(
		rasterizeRadialGradient(
			{ center: point(0.5, 0.5), radiusX: 1 / 3, radiusY: 1 / 3, rotation: 0, feather: 0 },
			2,
			6
		),
		Uint8Array.from([0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0])
	);
});

test('rotates an ellipse so its filled span runs along the rotated major axis', () => {
	assert.deepEqual(
		rasterizeRadialGradient(
			{ center: point(0.5, 0.5), radiusX: 0.5, radiusY: 0.1, rotation: Math.PI / 2, feather: 0 },
			5,
			5
		),
		Uint8Array.from([
			...[0, 0, 255, 0, 0],
			...[0, 0, 255, 0, 0],
			...[0, 0, 255, 0, 0],
			...[0, 0, 255, 0, 0],
			...[0, 0, 255, 0, 0]
		])
	);
});

test('lands the 50% row at an off-center anchor', () => {
	const alpha = rasterizeLinearGradient(
		{ anchor: point(0.5, 0.25), rotation: Math.PI / 2, compression: 0.4 },
		3,
		10
	);
	assert.deepEqual(Array.from(alpha.slice(2 * 3, 2 * 3 + 3)), [128, 128, 128]);
});
