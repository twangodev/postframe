import assert from 'node:assert/strict';
import test from 'node:test';

import { maskBoundaryPreview, maskEdgePreview } from '../src/lib/mask-preview.ts';

test('isolates the visible transition around a mask boundary', () => {
	assert.deepEqual(
		maskEdgePreview(Uint8Array.from([0, 0, 255, 255, 255]), 5, 1),
		Uint8Array.from([0, 255, 255, 0, 0])
	);
});

test('adds a one-pixel halo around the visible mask boundary', () => {
	assert.deepEqual(maskBoundaryPreview(Uint8Array.from([0, 0, 255, 255, 255]), 5, 1), {
		edge: Uint8Array.from([0, 255, 255, 0, 0]),
		halo: Uint8Array.from([255, 255, 255, 255, 0])
	});
});
