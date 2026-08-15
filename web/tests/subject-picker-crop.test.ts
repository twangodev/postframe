import assert from 'node:assert/strict';
import test from 'node:test';

import { coverCrop } from '../src/lib/subject-picker-crop.ts';

const CHIP_ASPECT = 0.5;

test('a wide box fills the chip height and centers the horizontal overflow', () => {
	const crop = coverCrop({ x: 0.25, y: 0.4, width: 0.5, height: 0.2 }, CHIP_ASPECT);
	assert.deepEqual(crop, { size: '1000% 500%', position: '50% 50%' });
});

test('a tall box fills the chip width and centers the vertical overflow', () => {
	const crop = coverCrop({ x: 0, y: 0, width: 0.25, height: 1 }, CHIP_ASPECT);
	assert.deepEqual(crop, { size: '400% 200%', position: '0% 50%' });
});

test('a box matching the chip aspect fills the chip exactly', () => {
	const crop = coverCrop({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, CHIP_ASPECT);
	assert.deepEqual(crop, { size: '400% 200%', position: '66.6667% 50%' });
});

test('the image aspect decides whether a normalized box is wide or tall', () => {
	const crop = coverCrop({ x: 0.375, y: 0.25, width: 0.25, height: 0.5 }, CHIP_ASPECT, 2);
	assert.deepEqual(crop, { size: '800% 200%', position: '50% 50%' });
});
