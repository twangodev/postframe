import assert from 'node:assert/strict';
import test from 'node:test';

import { ROTATION_SNAP } from '../src/lib/drag-constraints.ts';
import { MIN_GRADIENT_EXTENT } from '../src/lib/mask-gizmo.ts';
import { linearGeometryFromSpan } from './gizmo-fixtures.ts';
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

test('span drags centre the gradient between press and release', () => {
	const grip = { kind: 'handle', handle: 'span' } as const;
	const dragged = reduceLinearDrag(geometry, grip, { x: 60, y: 50 }, { x: 140, y: 50 }, image, {
		shift: false
	});
	assert.deepEqual(dragged.anchor, { x: 0.5, y: 0.5 });
	assert.equal(dragged.rotation, 0);
	assertClose(dragged.compression, 0.2);
	const snapped = reduceLinearDrag(geometry, grip, { x: 60, y: 50 }, { x: 140, y: 55 }, image, {
		shift: true
	});
	assertClose(snapped.rotation, 0);
	const steep = reduceLinearDrag(geometry, grip, { x: 100, y: 90 }, { x: 130, y: 10 }, image, {
		shift: true
	});
	assertClose(steep.rotation, -5 * ROTATION_SNAP);
	assert.deepEqual(steep.anchor, { x: 0.575, y: 0.5 });
	const collapsed = reduceLinearDrag(geometry, grip, { x: 60, y: 50 }, { x: 60, y: 50 }, image, {
		shift: false
	});
	assert.deepEqual(collapsed, geometry);
});

test('hit-testing never offers the create-only span grip', () => {
	for (const point of [
		{ x: 140, y: 50 },
		{ x: 60, y: 50 },
		{ x: 140, y: 90 },
		{ x: 100, y: 90 }
	]) {
		const hit = hitTestLinear(geometry, point, image, 5);
		assert.ok(hit?.kind !== 'handle' || hit.handle !== 'span');
	}
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

test('shift locks body drags to the dominant axis', () => {
	const grip = { kind: 'body' } as const;
	const horizontal = reduceLinearDrag(geometry, grip, { x: 100, y: 50 }, { x: 140, y: 62 }, image, {
		shift: true
	});
	assert.deepEqual(horizontal.anchor, { x: 0.7, y: 0.5 });
	const vertical = reduceLinearDrag(geometry, grip, { x: 100, y: 50 }, { x: 110, y: 90 }, image, {
		shift: true
	});
	assert.deepEqual(vertical.anchor, { x: 0.5, y: 0.9 });
});
