import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDuration } from '../src/lib/format-duration.ts';

test('formats durations at the coarsest useful unit', () => {
	assert.equal(formatDuration(0.2), '1 s');
	assert.equal(formatDuration(8.4), '8 s');
	assert.equal(formatDuration(59.6), '1 min');
	assert.equal(formatDuration(90), '2 min');
	assert.equal(formatDuration(3600), '1 h');
	assert.equal(formatDuration(3900), '1 h 5 min');
});
