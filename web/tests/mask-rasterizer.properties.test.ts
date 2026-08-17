import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	rasterizeBrushStrokes,
	rasterizeLinearGradient,
	rasterizeRadialGradient,
	rasterizeStrokeOnto,
	type MaskBrushStroke
} from '../src/lib/mask-rasterizer.ts';

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const rotation = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const extent = fc.double({ min: 0.001, max: 1, noNaN: true });
const dimension = fc.integer({ min: 1, max: 40 });

const strokeArbitrary: fc.Arbitrary<MaskBrushStroke> = fc.record({
	points: fc.array(fc.record({ x: unit, y: unit }), { minLength: 1, maxLength: 12 }),
	size: fc.double({ min: 0.01, max: 0.2, noNaN: true }),
	feather: unit,
	flow: unit
});

const canvasArbitrary = fc.record({
	strokes: fc.array(strokeArbitrary, { minLength: 1, maxLength: 6 }),
	width: fc.integer({ min: 1, max: 40 }),
	height: fc.integer({ min: 1, max: 40 })
});

test('rasterizing all strokes equals folding strokes onto the accumulated plane (seed 1101)', () => {
	fc.assert(
		fc.property(canvasArbitrary, ({ strokes, width, height }) => {
			const all = rasterizeBrushStrokes(strokes, width, height);
			const folded = strokes.reduce<Uint8Array>(
				(plane, stroke) => rasterizeStrokeOnto(plane, stroke, width, height),
				new Uint8Array(width * height)
			);
			assert.deepEqual(all, folded);
		}),
		{ seed: 1101, path: undefined }
	);
});

test('appending strokes only ever grows alpha and stays within the plane (seed 1102)', () => {
	fc.assert(
		fc.property(canvasArbitrary, ({ strokes, width, height }) => {
			let previous: Uint8Array = new Uint8Array(width * height);
			for (const stroke of strokes) {
				const next = rasterizeStrokeOnto(Uint8Array.from(previous), stroke, width, height);
				assert.equal(next.length, width * height);
				for (let index = 0; index < next.length; index += 1) {
					assert.ok(next[index]! >= previous[index]!, `alpha shrank at ${index}`);
				}
				previous = next;
			}
		}),
		{ seed: 1102, path: undefined }
	);
});

const linearGeometryArbitrary = fc.record({
	anchor: fc.record({ x: unit, y: unit }),
	rotation,
	compression: extent,
	width: dimension,
	height: dimension
});

test('linear gradient alpha is monotonically non-decreasing along its rotation axis (seed 1103)', () => {
	fc.assert(
		fc.property(linearGeometryArbitrary, ({ anchor, rotation, compression, width, height }) => {
			const alpha = rasterizeLinearGradient({ anchor, rotation, compression }, width, height);
			const originX = anchor.x * width;
			const originY = anchor.y * height;
			const cos = Math.cos(rotation);
			const sin = Math.sin(rotation);
			const samples: { along: number; value: number }[] = [];
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					const along = (x + 0.5 - originX) * cos + (y + 0.5 - originY) * sin;
					samples.push({ along, value: alpha[y * width + x]! });
				}
			}
			samples.sort((a, b) => a.along - b.along);
			for (let index = 1; index < samples.length; index += 1) {
				assert.ok(
					samples[index]!.value >= samples[index - 1]!.value,
					'alpha decreased along the gradient axis'
				);
			}
		}),
		{ seed: 1103, path: undefined }
	);
});

test('linear gradient alpha is point-symmetric through a centered anchor (seed 1104)', () => {
	fc.assert(
		fc.property(
			fc.record({ rotation, compression: extent, width: dimension, height: dimension }),
			({ rotation, compression, width, height }) => {
				const alpha = rasterizeLinearGradient(
					{ anchor: { x: 0.5, y: 0.5 }, rotation, compression },
					width,
					height
				);
				for (let y = 0; y < height; y += 1) {
					for (let x = 0; x < width; x += 1) {
						const mirrored = alpha[(height - 1 - y) * width + (width - 1 - x)]!;
						const sum = alpha[y * width + x]! + mirrored;
						assert.ok(Math.abs(sum - 255) <= 1, `reflected pair summed to ${sum}, not ~255`);
					}
				}
			}
		),
		{ seed: 1104, path: undefined }
	);
});

const radialGeometryArbitrary = fc.record({
	center: fc.record({ x: unit, y: unit }),
	radiusX: extent,
	radiusY: extent,
	rotation,
	feather: unit,
	width: dimension,
	height: dimension
});

test('radial gradient alpha is monotonically non-increasing with distance from the center (seed 1105)', () => {
	fc.assert(
		fc.property(
			radialGeometryArbitrary,
			({ center, radiusX, radiusY, rotation, feather, width, height }) => {
				const alpha = rasterizeRadialGradient(
					{ center, radiusX, radiusY, rotation, feather },
					width,
					height
				);
				const originX = center.x * width;
				const originY = center.y * height;
				const maxDim = Math.max(width, height);
				const cos = Math.cos(rotation);
				const sin = Math.sin(rotation);
				const samples: { reach: number; value: number }[] = [];
				for (let y = 0; y < height; y += 1) {
					for (let x = 0; x < width; x += 1) {
						const dx = x + 0.5 - originX;
						const dy = y + 0.5 - originY;
						const major = (dx * cos + dy * sin) / (radiusX * maxDim);
						const minor = (dy * cos - dx * sin) / (radiusY * maxDim);
						samples.push({ reach: Math.hypot(major, minor), value: alpha[y * width + x]! });
					}
				}
				samples.sort((a, b) => a.reach - b.reach);
				for (let index = 1; index < samples.length; index += 1) {
					assert.ok(
						samples[index]!.value <= samples[index - 1]!.value,
						'alpha increased with distance from the center'
					);
				}
			}
		),
		{ seed: 1105, path: undefined }
	);
});

test('radial gradient alpha is point-symmetric through a centered ellipse (seed 1106)', () => {
	fc.assert(
		fc.property(
			fc.record({
				radiusX: extent,
				radiusY: extent,
				rotation,
				feather: unit,
				width: dimension,
				height: dimension
			}),
			({ radiusX, radiusY, rotation, feather, width, height }) => {
				const alpha = rasterizeRadialGradient(
					{ center: { x: 0.5, y: 0.5 }, radiusX, radiusY, rotation, feather },
					width,
					height
				);
				for (let y = 0; y < height; y += 1) {
					for (let x = 0; x < width; x += 1) {
						const mirrored = alpha[(height - 1 - y) * width + (width - 1 - x)]!;
						assert.equal(alpha[y * width + x], mirrored);
					}
				}
			}
		),
		{ seed: 1106, path: undefined }
	);
});
