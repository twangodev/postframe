import assert from 'node:assert/strict';
import test from 'node:test';

import { cameraMatchOpening } from '../src/lib/camera-match.ts';

test('asks, applies, or starts neutral only for an undecided RAW', () => {
	assert.equal(cameraMatchOpening('pending', 'ask'), 'prompt');
	assert.equal(cameraMatchOpening('pending', 'always'), 'apply');
	assert.equal(cameraMatchOpening('pending', 'never'), 'neutral');

	for (const status of ['legacy', 'dismissed', 'applied'] as const) {
		assert.equal(cameraMatchOpening(status, 'always'), 'unchanged');
		assert.equal(cameraMatchOpening(status, 'never'), 'unchanged');
	}
});
