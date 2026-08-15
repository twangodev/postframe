import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	rasterizeBrushStrokes,
	rasterizeStrokeOnto,
	type MaskBrushStroke
} from '../src/lib/mask-rasterizer.ts';

const unit = fc.double({ min: 0, max: 1, noNaN: true });

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
