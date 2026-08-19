import assert from 'node:assert/strict';
import test from 'node:test';

import { dashes, hairline } from '../src/lib/overlay-frame.ts';

const frame = { image: { width: 400, height: 300 }, scale: 2 };

test('hairline converts screen pixels into image units', () => {
	assert.equal(hairline(frame), 0.5);
	assert.equal(hairline(frame, 3), 1.5);
});

test('dashes keep their on/off rhythm at any zoom', () => {
	assert.equal(dashes(frame), '3 2');
	assert.equal(dashes(frame, 8, 2), '4 1');
});
