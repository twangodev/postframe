import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MIN_GRADIENT_EXTENT,
	ROTATION_SNAP,
	linearGeometryFromSpan,
	normalizeRotation,
	snapRotation
} from '../src/lib/mask-gizmo.ts';
import { hitTestLinear, linearLayout, reduceLinearDrag } from '../src/lib/mask-gizmo-linear.ts';

const image = { width: 200, height: 100 };
const geometry = { anchor: { x: 0.5, y: 0.5 }, rotation: 0, compression: 0.2 };

function assertClose(actual: number, expected: number, epsilon = 1e-9) {
	assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~ ${expected}`);
}

test('lays the linear gizmo out along its rotation', () => {
	const layout = linearLayout(geometry, image);
	assert.deepEqual(layout.anchor, { x: 100, y: 50 });
	assert.deepEqual(layout.positive, { x: 140, y: 50 });
	assert.deepEqual(layout.negative, { x: 60, y: 50 });
	assertClose(layout.reach, 40);
});

test('hit-tests dots, boundary lines, body, and misses in priority order', () => {
	assert.deepEqual(hitTestLinear(geometry, { x: 143, y: 52 }, image, 5), {
		kind: 'handle',
		handle: 'positive'
	});
	assert.deepEqual(hitTestLinear(geometry, { x: 58, y: 48 }, image, 5), {
		kind: 'handle',
		handle: 'negative'
	});
	assert.deepEqual(hitTestLinear(geometry, { x: 140, y: 90 }, image, 5), {
		kind: 'handle',
		handle: 'front'
	});
	assert.deepEqual(hitTestLinear(geometry, { x: 60, y: 90 }, image, 5), {
		kind: 'handle',
		handle: 'back'
	});
	assert.deepEqual(hitTestLinear(geometry, { x: 100, y: 90 }, image, 5), { kind: 'body' });
	assert.equal(hitTestLinear(geometry, { x: 120, y: 90 }, image, 5), null);
});

test('translates the anchor on body drags and clamps it to the image', () => {
	const grip = { kind: 'body' } as const;
	const dragged = reduceLinearDrag(geometry, grip, { x: 100, y: 50 }, { x: 110, y: 60 }, image, {
		shift: false
	});
	assert.deepEqual(dragged.anchor, { x: 0.55, y: 0.6 });
	assert.equal(dragged.rotation, geometry.rotation);
	assert.equal(dragged.compression, geometry.compression);
	const clamped = reduceLinearDrag(geometry, grip, { x: 100, y: 50 }, { x: -300, y: 50 }, image, {
		shift: false
	});
	assert.equal(clamped.anchor.x, 0);
});

test('endpoint drags set rotation and compression around a fixed anchor', () => {
	const grip = { kind: 'handle', handle: 'positive' } as const;
	const dragged = reduceLinearDrag(geometry, grip, { x: 140, y: 50 }, { x: 100, y: 90 }, image, {
		shift: false
	});
	assertClose(dragged.rotation, Math.PI / 2);
	assertClose(dragged.compression, 0.2);
	assert.deepEqual(dragged.anchor, geometry.anchor);
});

test('dragging the negative dot mirrors into the same orientation', () => {
	const grip = { kind: 'handle', handle: 'negative' } as const;
	const dragged = reduceLinearDrag(geometry, grip, { x: 60, y: 50 }, { x: 100, y: 10 }, image, {
		shift: false
	});
	assertClose(dragged.rotation, Math.PI / 2);
	assertClose(dragged.compression, 0.2);
});

test('shift snaps endpoint rotation to fifteen-degree increments', () => {
	const grip = { kind: 'handle', handle: 'positive' } as const;
	const nearlyFlat = reduceLinearDrag(geometry, grip, { x: 140, y: 50 }, { x: 140, y: 55 }, image, {
		shift: true
	});
	assertClose(nearlyFlat.rotation, 0);
	const steep = reduceLinearDrag(geometry, grip, { x: 140, y: 50 }, { x: 110, y: 90 }, image, {
		shift: true
	});
	assertClose(steep.rotation, 5 * ROTATION_SNAP);
});

test('boundary drags change compression only, symmetrically', () => {
	const front = reduceLinearDrag(
		geometry,
		{ kind: 'handle', handle: 'front' },
		{ x: 140, y: 90 },
		{ x: 155, y: 70 },
		image,
		{ shift: false }
	);
	assertClose(front.compression, 0.275);
	assert.equal(front.rotation, geometry.rotation);
	const back = reduceLinearDrag(
		geometry,
		{ kind: 'handle', handle: 'back' },
		{ x: 60, y: 90 },
		{ x: 30, y: 50 },
		image,
		{ shift: false }
	);
	assertClose(back.compression, 0.35);
});

test('degenerate drags floor compression and never collapse the gizmo', () => {
	const grip = { kind: 'handle', handle: 'positive' } as const;
	const tiny = reduceLinearDrag(geometry, grip, { x: 140, y: 50 }, { x: 100.05, y: 50 }, image, {
		shift: false
	});
	assert.equal(tiny.compression, MIN_GRADIENT_EXTENT);
	const zero = reduceLinearDrag(geometry, grip, { x: 140, y: 50 }, { x: 100, y: 50 }, image, {
		shift: false
	});
	assert.deepEqual(zero, geometry);
});

test('converts an endpoint span into transform parameters aspect-correctly', () => {
	const horizontal = linearGeometryFromSpan(
		{ x: 0.25, y: 0.5 },
		{ x: 0.75, y: 0.5 },
		{ width: 200, height: 100 }
	);
	assert.deepEqual(horizontal.anchor, { x: 0.5, y: 0.5 });
	assert.equal(horizontal.rotation, 0);
	assertClose(horizontal.compression, 0.25);
	const vertical = linearGeometryFromSpan(
		{ x: 0.5, y: 0 },
		{ x: 0.5, y: 1 },
		{ width: 200, height: 100 }
	);
	assertClose(vertical.rotation, Math.PI / 2);
	assertClose(vertical.compression, 0.25);
	const collapsed = linearGeometryFromSpan({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, image);
	assert.equal(collapsed.rotation, 0);
	assert.equal(collapsed.compression, MIN_GRADIENT_EXTENT);
});

test('normalizes and snaps rotations', () => {
	assertClose(normalizeRotation(Math.PI * 2.5), Math.PI / 2);
	assertClose(normalizeRotation(-Math.PI * 1.5), Math.PI / 2);
	assert.equal(snapRotation(0.3, false), 0.3);
	assertClose(snapRotation(0.3, true), ROTATION_SNAP);
});
