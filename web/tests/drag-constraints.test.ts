import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ROTATION_SNAP,
	axisLockedDelta,
	extendedStroke,
	normalizeRotation,
	rotationLabel,
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

test('labels free rotations with one decimal and locked ones as whole degrees', () => {
	assert.equal(rotationLabel(Math.PI / 4, false), '45.0°');
	assert.equal(rotationLabel(0.653, false), '37.4°');
	assert.equal(rotationLabel(Math.PI / 4, true), '45°');
	assert.equal(rotationLabel(-Math.PI / 2, true), '-90°');
});

test('starts a stroke from its first point', () => {
	assert.deepEqual(extendedStroke([], { x: 0.5, y: 0.5 }, 0.003), [{ x: 0.5, y: 0.5 }]);
});

test('appends points that clear the minimum spacing', () => {
	assert.deepEqual(extendedStroke([{ x: 0.5, y: 0.5 }], { x: 0.51, y: 0.5 }, 0.003), [
		{ x: 0.5, y: 0.5 },
		{ x: 0.51, y: 0.5 }
	]);
});

test('declines points that crowd the previous one or are missing', () => {
	assert.equal(extendedStroke([{ x: 0.5, y: 0.5 }], { x: 0.501, y: 0.5 }, 0.003), null);
	assert.equal(extendedStroke([{ x: 0.5, y: 0.5 }], null, 0.003), null);
});

test('labels normalize wrapped rotations and never show negative zero', () => {
	assert.equal(rotationLabel(Math.PI * 2.5, true), '90°');
	assert.equal(rotationLabel(-0.0004, false), '0.0°');
	assert.equal(rotationLabel(-0.001, true), '0°');
});
