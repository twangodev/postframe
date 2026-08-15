import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { composeMaskRasters, type MaskRasterData } from '../src/lib/mask-raster.ts';

const dimensions = fc.record({
	width: fc.integer({ min: 1, max: 64 }),
	height: fc.integer({ min: 1, max: 64 })
});

const rasterArbitrary: fc.Arbitrary<MaskRasterData> = dimensions.chain(({ width, height }) =>
	fc
		.uint8Array({ minLength: width * height, maxLength: width * height })
		.map((alpha) => ({ width, height, alpha }))
);

const matchedPairArbitrary = dimensions.chain(({ width, height }) => {
	const plane = fc.uint8Array({ minLength: width * height, maxLength: width * height });
	return fc.record({
		base: plane.map((alpha) => ({ width, height, alpha })),
		layer: plane.map((alpha) => ({ width, height, alpha })),
		inverted: fc.boolean()
	});
});

const layerArbitrary = fc.record({
	operation: fc.constantFrom<'add' | 'subtract' | 'intersect'>('add', 'subtract', 'intersect'),
	inverted: fc.boolean(),
	raster: rasterArbitrary
});

test('subtract never raises and add never lowers the base mask (seed 2201)', () => {
	fc.assert(
		fc.property(matchedPairArbitrary, ({ base, layer, inverted }) => {
			const subtracted = composeMaskRasters([
				{ operation: 'add', raster: base },
				{ operation: 'subtract', inverted, raster: layer }
			]);
			const added = composeMaskRasters([
				{ operation: 'add', raster: base },
				{ operation: 'add', inverted, raster: layer }
			]);
			for (let index = 0; index < base.alpha.length; index += 1) {
				assert.ok(subtracted!.alpha[index]! <= base.alpha[index]!, `subtract raised ${index}`);
				assert.ok(added!.alpha[index]! >= base.alpha[index]!, `add lowered ${index}`);
			}
		}),
		{ seed: 2201, path: undefined }
	);
});

test('intersect stays below both the base and the sampled layer (seed 2202)', () => {
	fc.assert(
		fc.property(matchedPairArbitrary, ({ base, layer, inverted }) => {
			const intersected = composeMaskRasters([
				{ operation: 'add', raster: base },
				{ operation: 'intersect', inverted, raster: layer }
			]);
			for (let index = 0; index < base.alpha.length; index += 1) {
				const sampled = inverted ? 255 - layer.alpha[index]! : layer.alpha[index]!;
				const bound = Math.min(base.alpha[index]!, sampled);
				assert.ok(intersected!.alpha[index]! <= bound, `intersect exceeded ${index}`);
			}
		}),
		{ seed: 2202, path: undefined }
	);
});

test('a single additive layer composes to itself and inverts exactly (seed 2203)', () => {
	fc.assert(
		fc.property(rasterArbitrary, (raster) => {
			const identity = composeMaskRasters([{ operation: 'add', raster }]);
			assert.equal(identity!.width, raster.width);
			assert.equal(identity!.height, raster.height);
			assert.deepEqual(identity!.alpha, raster.alpha);

			const inverted = composeMaskRasters([{ operation: 'add', inverted: true, raster }]);
			for (let index = 0; index < raster.alpha.length; index += 1) {
				assert.equal(inverted!.alpha[index], 255 - raster.alpha[index]!);
			}
		}),
		{ seed: 2203, path: undefined }
	);
});

test('mixed-resolution layers keep first-layer dimensions and shift monotonically (seed 2204)', () => {
	fc.assert(
		fc.property(fc.array(layerArbitrary, { minLength: 1, maxLength: 4 }), (layers) => {
			const first = layers[0]!.raster;
			let previous: Uint8Array | null = null;
			for (let count = 1; count <= layers.length; count += 1) {
				const composed = composeMaskRasters(layers.slice(0, count));
				assert.equal(composed!.width, first.width);
				assert.equal(composed!.height, first.height);
				assert.equal(composed!.alpha.length, first.width * first.height);
				if (previous) {
					const grows = layers[count - 1]!.operation === 'add';
					for (let index = 0; index < composed!.alpha.length; index += 1) {
						const before: number = previous[index]!;
						const after: number = composed!.alpha[index]!;
						assert.ok(grows ? after >= before : after <= before, `layer ${count} at ${index}`);
					}
				}
				previous = composed!.alpha;
			}
		}),
		{ seed: 2204, path: undefined }
	);
});
