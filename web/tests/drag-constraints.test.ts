import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ROTATION_SNAP,
	axisLockedDelta,
	normalizeRotation,
	snapRotation
} from '../src/lib/drag-constraints.ts';

function assertClose(actual: number, expected: number, epsilon = 1e-9) {
	assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~ ${expected}`);
}

test('passes deltas through untouched while the lock is inactive', () => {
	assert.deepEqual(axisLockedDelta({ x: 7, y: -3 }, false), { x: 7, y: -3 });
});

test('locks a mostly-horizontal delta onto the horizontal axis', () => {
	assert.deepEqual(axisLockedDelta({ x: 40, y: -12 }, true), { x: 40, y: 0 });
	assert.deepEqual(axisLockedDelta({ x: -25, y: 8 }, true), { x: -25, y: 0 });
});

test('locks a mostly-vertical delta onto the vertical axis', () => {
	assert.deepEqual(axisLockedDelta({ x: 12, y: -40 }, true), { x: 0, y: -40 });
});

test('resolves a diagonal tie to the horizontal axis', () => {
	assert.deepEqual(axisLockedDelta({ x: 30, y: 30 }, true), { x: 30, y: 0 });
});

test('normalizes rotations into the half-open interval around zero', () => {
	assertClose(normalizeRotation(Math.PI * 2.5), Math.PI / 2);
	assertClose(normalizeRotation(-Math.PI * 1.5), Math.PI / 2);
});

test('snaps rotations to fifteen-degree increments only while active', () => {
	assert.equal(snapRotation(0.3, false), 0.3);
	assertClose(snapRotation(0.3, true), ROTATION_SNAP);
});
