import assert from 'node:assert/strict';
import test from 'node:test';

import { positiveOrNull } from '../src/lib/photo-source.ts';

test('positiveOrNull keeps positive finite numbers', () => {
	assert.equal(positiveOrNull(35), 35);
	assert.equal(positiveOrNull(1.4), 1.4);
	assert.equal(positiveOrNull(1 / 4000), 1 / 4000);
});

test('positiveOrNull maps unknown-value markers to null', () => {
	assert.equal(positiveOrNull(0), null);
	assert.equal(positiveOrNull(-1), null);
	assert.equal(positiveOrNull(Number.NaN), null);
	assert.equal(positiveOrNull(Number.POSITIVE_INFINITY), null);
	assert.equal(positiveOrNull(null), null);
	assert.equal(positiveOrNull(undefined), null);
});
