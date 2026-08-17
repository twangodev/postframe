import assert from 'node:assert/strict';
import test from 'node:test';

import { ROTATION_SNAP } from '../src/lib/mask-gizmo.ts';
import {
	ellipseOutlineDistance,
	hitTestRadial,
	radialLayout,
	reduceRadialDrag
} from '../src/lib/mask-gizmo-radial.ts';

const image = { width: 200, height: 100 };
const geometry = {
	center: { x: 0.5, y: 0.5 },
	radiusX: 0.3,
	radiusY: 0.15,
	rotation: 0,
	feather: 0.5
};

function assertClose(actual: number, expected: number, epsilon = 1e-6) {
	assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~ ${expected}`);
}

test('lays out axis dots and the rotate handle along the major axis', () => {
	const layout = radialLayout(geometry, image, 12);
	assert.deepEqual(layout.center, { x: 100, y: 50 });
	assert.deepEqual(layout.majorPositive, { x: 160, y: 50 });
	assert.deepEqual(layout.majorNegative, { x: 40, y: 50 });
	assert.deepEqual(layout.minorPositive, { x: 100, y: 80 });
	assert.deepEqual(layout.minorNegative, { x: 100, y: 20 });
	assert.deepEqual(layout.rotate, { x: 172, y: 50 });
});

test('measures distance to an axis-aligned ellipse outline', () => {
	assertClose(ellipseOutlineDistance({ x: 90, y: 0 }, 60, 30), 30);
	assertClose(ellipseOutlineDistance({ x: 0, y: 10 }, 60, 30), 20);
	assert.ok(ellipseOutlineDistance({ x: 42, y: 21 }, 60, 30) < 1.5);
});

test('hit-tests dots, rotate, feather ring, body, and misses', () => {
	assert.deepEqual(hitTestRadial(geometry, { x: 158, y: 52 }, image, 5, 12), {
		kind: 'handle',
		handle: 'major-positive'
	});
	assert.deepEqual(hitTestRadial(geometry, { x: 100, y: 78 }, image, 5, 12), {
		kind: 'handle',
		handle: 'minor-positive'
	});
	assert.deepEqual(hitTestRadial(geometry, { x: 172, y: 50 }, image, 5, 12), {
		kind: 'handle',
		handle: 'rotate'
	});
	// feather 0.5 -> core ellipse radii (30, 15); its outline passes through (130, 50)
	assert.deepEqual(hitTestRadial(geometry, { x: 131, y: 50 }, image, 5, 12), {
		kind: 'handle',
		handle: 'feather'
	});
	assert.deepEqual(hitTestRadial(geometry, { x: 105, y: 52 }, image, 5, 12), { kind: 'body' });
	assert.equal(hitTestRadial(geometry, { x: 190, y: 90 }, image, 5, 12), null);
});

test('axis drags resize one radius; shift keeps a circle', () => {
	const grip = { kind: 'handle', handle: 'major-positive' } as const;
	const wider = reduceRadialDrag(geometry, grip, { x: 160, y: 50 }, { x: 180, y: 50 }, image, {
		shift: false
	});
	assertClose(wider.radiusX, 0.4);
	assertClose(wider.radiusY, geometry.radiusY);
	const circle = reduceRadialDrag(geometry, grip, { x: 160, y: 50 }, { x: 180, y: 50 }, image, {
		shift: true
	});
	assertClose(circle.radiusX, 0.4);
	assertClose(circle.radiusY, 0.4);
	const minor = reduceRadialDrag(
		geometry,
		{ kind: 'handle', handle: 'minor-negative' },
		{ x: 100, y: 20 },
		{ x: 100, y: 30 },
		image,
		{ shift: false }
	);
	assertClose(minor.radiusY, 0.1);
});

test('the radius pseudo-handle drags a circle from the center', () => {
	const dragged = reduceRadialDrag(
		geometry,
		{ kind: 'handle', handle: 'radius' },
		{ x: 100, y: 50 },
		{ x: 100, y: 90 },
		image,
		{ shift: false }
	);
	assertClose(dragged.radiusX, 0.2);
	assertClose(dragged.radiusY, 0.2);
});

test('rotation applies the pointer angle delta, not the absolute angle', () => {
	const grip = { kind: 'handle', handle: 'rotate' } as const;
	const dragged = reduceRadialDrag(geometry, grip, { x: 172, y: 50 }, { x: 100, y: 122 }, image, {
		shift: false
	});
	assertClose(dragged.rotation, Math.PI / 2);
	const snapped = reduceRadialDrag(geometry, grip, { x: 172, y: 50 }, { x: 165, y: 68 }, image, {
		shift: true
	});
	assertClose(snapped.rotation % ROTATION_SNAP, 0);
});

test('feather drags map the pointer reach onto the core', () => {
	const grip = { kind: 'handle', handle: 'feather' } as const;
	const softer = reduceRadialDrag(geometry, grip, { x: 130, y: 50 }, { x: 115, y: 50 }, image, {
		shift: false
	});
	assertClose(softer.feather, 0.75);
	const hard = reduceRadialDrag(geometry, grip, { x: 130, y: 50 }, { x: 175, y: 50 }, image, {
		shift: false
	});
	assert.equal(hard.feather, 0);
});

test('body drags translate the center', () => {
	const dragged = reduceRadialDrag(
		geometry,
		{ kind: 'body' },
		{ x: 100, y: 50 },
		{ x: 120, y: 40 },
		image,
		{ shift: false }
	);
	assert.deepEqual(dragged.center, { x: 0.6, y: 0.4 });
});
