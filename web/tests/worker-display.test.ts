import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { apronRegion, cropRgba, type DisplayRegion } from '../src/lib/worker-display.ts';

const image = { width: 4000, height: 3000 };

test('an apron of zero leaves the region and its crop as they are', () => {
	const region: DisplayRegion = { x: 1023, y: 511, width: 514, height: 514, bin: 1 };
	assert.deepEqual(apronRegion(region, 0, image), {
		source: region,
		crop: { x: 0, y: 0, width: 514, height: 514 }
	});
	const binned: DisplayRegion = { x: 2044, y: 0, width: 957, height: 1024, bin: 4 };
	assert.deepEqual(apronRegion(binned, 0, image), {
		source: binned,
		crop: { x: 0, y: 0, width: 240, height: 256 }
	});
});

test('an interior tile pads on every side and crops back from the pad', () => {
	const region: DisplayRegion = { x: 1023, y: 511, width: 514, height: 514, bin: 1 };
	assert.deepEqual(apronRegion(region, 20, image), {
		source: { x: 1003, y: 491, width: 554, height: 554, bin: 1 },
		crop: { x: 20, y: 20, width: 514, height: 514 }
	});
});

test('edge tiles clamp to the image and shrink the crop offset accordingly', () => {
	const origin: DisplayRegion = { x: 0, y: 0, width: 513, height: 513, bin: 1 };
	assert.deepEqual(apronRegion(origin, 20, image), {
		source: { x: 0, y: 0, width: 533, height: 533, bin: 1 },
		crop: { x: 0, y: 0, width: 513, height: 513 }
	});
	const corner: DisplayRegion = { x: 3580, y: 2555, width: 420, height: 445, bin: 1 };
	assert.deepEqual(apronRegion(corner, 20, image), {
		source: { x: 3560, y: 2535, width: 440, height: 465, bin: 1 },
		crop: { x: 20, y: 20, width: 420, height: 445 }
	});
});

test('a bin scales the pad to image pixels and the crop stays in binned pixels', () => {
	const region: DisplayRegion = { x: 2044, y: 0, width: 956, height: 1024, bin: 4 };
	assert.deepEqual(apronRegion(region, 10, { width: 3000, height: 2000 }), {
		source: { x: 2004, y: 0, width: 996, height: 1064, bin: 4 },
		crop: { x: 10, y: 0, width: 239, height: 256 }
	});
});

const binArbitrary = fc.constantFrom(1, 2, 4, 8, 16, 32, 64);

const tileArbitrary = fc
	.tuple(
		binArbitrary,
		fc.integer({ min: 1, max: 6000 }),
		fc.integer({ min: 1, max: 4000 }),
		fc.integer({ min: 0, max: 8 }),
		fc.integer({ min: 0, max: 8 }),
		fc.integer({ min: 1, max: 520 }),
		fc.integer({ min: 1, max: 520 }),
		fc.integer({ min: 0, max: 250 })
	)
	.map(([bin, width, height, column, row, columns, rows, apron]) => {
		const x = Math.min(column * 512 * bin, (Math.ceil(width / bin) - 1) * bin);
		const y = Math.min(row * 512 * bin, (Math.ceil(height / bin) - 1) * bin);
		return {
			bin,
			image: { width, height },
			region: {
				x,
				y,
				width: Math.min(columns * bin, width - x),
				height: Math.min(rows * bin, height - y),
				bin
			} satisfies DisplayRegion,
			apron
		};
	});

test('the padded source always contains the tile inside the image and its crop fits the padded output (seed 4183)', () => {
	fc.assert(
		fc.property(tileArbitrary, ({ image, region, apron }) => {
			const { source, crop } = apronRegion(region, apron, image);
			assert.equal(source.bin, region.bin);
			assert.ok(source.x >= 0 && source.y >= 0);
			assert.ok(source.x <= region.x && source.y <= region.y);
			assert.ok(source.x + source.width <= image.width);
			assert.ok(source.y + source.height <= image.height);
			assert.ok(source.x + source.width >= region.x + region.width);
			assert.ok(source.y + source.height >= region.y + region.height);
			assert.equal(source.x % region.bin, 0);
			assert.equal(source.y % region.bin, 0);
			assert.equal(crop.x, (region.x - source.x) / region.bin);
			assert.equal(crop.y, (region.y - source.y) / region.bin);
			assert.equal(crop.width, Math.ceil(region.width / region.bin));
			assert.equal(crop.height, Math.ceil(region.height / region.bin));
			assert.ok(crop.x + crop.width <= Math.ceil(source.width / region.bin));
			assert.ok(crop.y + crop.height <= Math.ceil(source.height / region.bin));
			assert.ok(crop.x <= apron && crop.y <= apron);
		}),
		{ seed: 4183, path: undefined }
	);
});

test('cropping rgba pixels keeps every byte of the window in row order', () => {
	const stride = 5;
	const rgba = new Uint8Array(stride * 4 * 4).map((_, index) => index);
	const cropped = cropRgba(rgba, stride, { x: 1, y: 2, width: 3, height: 2 });
	assert.ok(cropped instanceof Uint8ClampedArray);
	assert.deepEqual(
		[...cropped],
		[
			...[...rgba.subarray((2 * stride + 1) * 4, (2 * stride + 4) * 4)],
			...[...rgba.subarray((3 * stride + 1) * 4, (3 * stride + 4) * 4)]
		]
	);
	assert.deepEqual([...cropRgba(rgba, stride, { x: 0, y: 0, width: 5, height: 4 })], [...rgba]);
});
