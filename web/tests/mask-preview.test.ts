import assert from 'node:assert/strict';
import test from 'node:test';

import { maskEdgePreview } from '../src/lib/mask-preview.ts';

test('isolates the visible transition around a mask boundary', () => {
	assert.deepEqual(
		maskEdgePreview(Uint8Array.from([0, 0, 255, 255, 255]), 5, 1),
		Uint8Array.from([0, 255, 255, 0, 0])
	);
});
