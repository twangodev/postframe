import assert from 'node:assert/strict';
import test from 'node:test';

import { guidedAlpha } from '../src/lib/guided-mask-refiner.ts';

test('preserves a constant alpha plane', () => {
	const guidance = Uint8Array.from({ length: 25 }, (_, index) => index * 10);
	const alpha = new Uint8Array(25).fill(73);

	assert.deepEqual(guidedAlpha(guidance, alpha, 5, 5, 2), alpha);
});

test('preserves a mask boundary aligned to a strong image edge', () => {
	const guidance = new Uint8Array(9 * 5);
	const alpha = new Uint8Array(9 * 5);
	for (let y = 0; y < 5; y += 1) {
		for (let x = 0; x < 9; x += 1) {
			if (x < 4) continue;
			guidance[y * 9 + x] = 255;
			alpha[y * 9 + x] = 255;
		}
	}
	const refined = guidedAlpha(guidance, alpha, 9, 5, 2, 0.000001);

	for (let y = 0; y < 5; y += 1) {
		assert.ok(refined[y * 9 + 3]! <= 1);
		assert.ok(refined[y * 9 + 4]! >= 254);
	}
});
