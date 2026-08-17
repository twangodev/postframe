import assert from 'node:assert/strict';
import test from 'node:test';

import { draggedPoint } from '../src/lib/mask-gizmo.ts';

const image = { width: 1000, height: 500 };

test('translates a normalized point by the pointer delta', () => {
	assert.deepEqual(
		draggedPoint({ x: 0.5, y: 0.5 }, { x: 100, y: 100 }, { x: 150, y: 80 }, image, {
			shift: false
		}),
		{ x: 0.55, y: 0.46 }
	);
});

test('locks the translation to the dominant axis under shift', () => {
	assert.deepEqual(
		draggedPoint({ x: 0.5, y: 0.5 }, { x: 100, y: 100 }, { x: 150, y: 80 }, image, {
			shift: true
		}),
		{ x: 0.55, y: 0.5 }
	);
});

test('clamps the translated point inside the image', () => {
	assert.deepEqual(
		draggedPoint({ x: 0.95, y: 0.5 }, { x: 0, y: 0 }, { x: 200, y: 0 }, image, { shift: false }),
		{ x: 1, y: 0.5 }
	);
});
