import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { adjustMaskEdges } from '../src/lib/mask-edge-adjustment.ts';
import type { MaskRasterData } from '../src/lib/mask-raster.ts';

const dimensions = fc.record({
	width: fc.integer({ min: 1, max: 16 }),
	height: fc.integer({ min: 1, max: 16 })
});

const rasterArbitrary: fc.Arbitrary<MaskRasterData> = dimensions.chain(({ width, height }) =>
	fc
		.uint8Array({ minLength: width * height, maxLength: width * height })
		.map((alpha) => ({ width, height, alpha }))
);

const settingsArbitrary = fc.record({
	contrast: fc.double({ min: 0, max: 100, noNaN: true }),
	feather: fc.double({ min: 0, max: 100, noNaN: true }),
	shift: fc.double({ min: -100, max: 100, noNaN: true })
});

test('neutral edge settings leave any raster untouched (seed 6601)', () => {
	fc.assert(
		fc.property(rasterArbitrary, (raster) => {
			const adjusted = adjustMaskEdges(raster, { contrast: 0, feather: 0, shift: 0 });
			assert.equal(adjusted.width, raster.width);
			assert.equal(adjusted.height, raster.height);
			assert.deepEqual(adjusted.alpha, raster.alpha);
		}),
		{ seed: 6601, path: undefined }
	);
});

test('constant planes stay constant under any edge settings (seed 6602)', () => {
	fc.assert(
		fc.property(
			dimensions,
			fc.integer({ min: 0, max: 255 }),
			settingsArbitrary,
			(dims, value, settings) => {
				const raster = {
					...dims,
					alpha: new Uint8Array(dims.width * dims.height).fill(value)
				};
				const adjusted = adjustMaskEdges(raster, settings);
				assert.equal(adjusted.alpha.length, raster.alpha.length);
				for (const pixel of adjusted.alpha) assert.equal(pixel, adjusted.alpha[0]);
				if (value === 0) assert.equal(adjusted.alpha[0] ?? 0, 0);
				if (value === 255) assert.equal(adjusted.alpha[0] ?? 255, 255);
			}
		),
		{ seed: 6602, path: undefined }
	);
});

test('pure shift only dilates outward or erodes inward, never both (seed 6603)', () => {
	fc.assert(
		fc.property(
			rasterArbitrary,
			fc.double({ min: -100, max: 100, noNaN: true }),
			(raster, shift) => {
				const adjusted = adjustMaskEdges(raster, { contrast: 0, feather: 0, shift });
				for (let index = 0; index < raster.alpha.length; index += 1) {
					const before = raster.alpha[index]!;
					const after = adjusted.alpha[index]!;
					if (shift >= 0) assert.ok(after >= before, `positive shift eroded ${index}`);
					else assert.ok(after <= before, `negative shift dilated ${index}`);
				}
			}
		),
		{ seed: 6603, path: undefined }
	);
});
