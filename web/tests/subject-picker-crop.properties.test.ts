import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { coverCrop } from '../src/lib/subject-picker-crop.ts';

const unit = fc.double({ min: 0, max: 1, noNaN: true });

const span = fc
	.tuple(unit, unit)
	.map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)))
	.filter(([start, end]) => end - start >= 0.005);

const boxArbitrary = fc
	.tuple(span, span)
	.map(([[x, right], [y, bottom]]) => ({ x, y, width: right - x, height: bottom - y }))
	.filter(({ x, y, width, height }) => x + width <= 1 && y + height <= 1);

const aspectArbitrary = fc.double({ min: 0.25, max: 4, noNaN: true });

function percents(value: string) {
	return value.split(' ').map((part) => {
		assert.ok(part.endsWith('%'), `expected percentage, got ${part}`);
		const parsed = Number.parseFloat(part);
		assert.ok(Number.isFinite(parsed), `expected finite percentage, got ${part}`);
		return parsed;
	});
}

test('cover crops scale past 100% on an axis and keep positions in range (seed 5501)', () => {
	fc.assert(
		fc.property(boxArbitrary, aspectArbitrary, aspectArbitrary, (box, chipAspect, imageAspect) => {
			const crop = coverCrop(box, chipAspect, imageAspect);
			const [sizeX, sizeY] = percents(crop.size);
			assert.ok(sizeX! > 0 && sizeY! > 0);
			assert.ok(Math.max(sizeX!, sizeY!) >= 100, `nothing covers: ${crop.size}`);
			const [positionX, positionY] = percents(crop.position);
			assert.ok(positionX! >= 0 && positionX! <= 100);
			assert.ok(positionY! >= 0 && positionY! <= 100);
		}),
		{ seed: 5501, path: undefined }
	);
});
