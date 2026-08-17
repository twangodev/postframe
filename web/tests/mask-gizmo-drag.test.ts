import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditMask } from '../src/lib/edit-document.ts';
import { MIN_GRADIENT_EXTENT } from '../src/lib/mask-gizmo.ts';
import { hitTestGizmo, reduceGizmoDrag, seedGizmoComponent } from '../src/lib/mask-gizmo-drag.ts';
import type { GradientComponent } from '../src/lib/mask-painting.ts';

const image = { width: 1000, height: 1000 };

const linear: GradientComponent = {
	id: 'component-linear',
	type: 'linear',
	operation: 'add',
	raster: null,
	anchor: { x: 0.5, y: 0.5 },
	rotation: 0,
	compression: 0.25
};

const radial: GradientComponent = {
	id: 'component-radial',
	type: 'radial',
	operation: 'add',
	raster: null,
	center: { x: 0.5, y: 0.5 },
	radiusX: 0.2,
	radiusY: 0.1,
	rotation: 0,
	feather: 0
};

test('routes linear components to the linear hit test', () => {
	assert.deepEqual(hitTestGizmo(linear, { x: 750, y: 500 }, image, 10, 24), {
		kind: 'handle',
		handle: 'positive'
	});
});

test('routes radial components to the radial hit test', () => {
	assert.deepEqual(hitTestGizmo(radial, { x: 724, y: 500 }, image, 10, 24), {
		kind: 'handle',
		handle: 'rotate'
	});
});

test('reduces a drag into a full component that keeps its identity', () => {
	const reduced = reduceGizmoDrag(
		linear,
		{ kind: 'body' },
		{ x: 500, y: 500 },
		{ x: 600, y: 550 },
		image,
		{ shift: false }
	);
	assert.equal(reduced.type, 'linear');
	if (reduced.type !== 'linear') return;
	assert.equal(reduced.id, 'component-linear');
	assert.equal(reduced.operation, 'add');
	assert.deepEqual(reduced.anchor, { x: 0.6, y: 0.55 });
});

test('routes radial reductions through the radial reducer', () => {
	const reduced = reduceGizmoDrag(
		radial,
		{ kind: 'handle', handle: 'major-positive' },
		{ x: 700, y: 500 },
		{ x: 800, y: 500 },
		image,
		{ shift: true }
	);
	assert.equal(reduced.type, 'radial');
	if (reduced.type !== 'radial') return;
	assert.equal(reduced.radiusX, 0.3);
	assert.equal(reduced.radiusY, 0.3);
});

test('seeds a fresh linear component at the pressed point with a span grip', () => {
	const mask = createEditMask('mask-1', 'linear');
	const seeded = seedGizmoComponent('linear', mask, { x: 250, y: 500 }, image);
	assert.ok(seeded);
	assert.deepEqual(seeded.grip, { kind: 'handle', handle: 'span' });
	assert.equal(seeded.component.type, 'linear');
	if (seeded.component.type !== 'linear') return;
	assert.ok(seeded.component.id);
	assert.equal(seeded.component.operation, 'add');
	assert.deepEqual(seeded.component.anchor, { x: 0.25, y: 0.5 });
	assert.equal(seeded.component.rotation, 0);
	assert.equal(seeded.component.compression, MIN_GRADIENT_EXTENT);
});

test('seeds a radial replacement that keeps the existing identity and feather', () => {
	const mask = createEditMask('mask-2', 'radial');
	mask.components.push({ ...radial, id: 'component-9', operation: 'subtract', feather: 0.8 });
	const seeded = seedGizmoComponent('radial', mask, { x: 400, y: 600 }, image);
	assert.ok(seeded);
	assert.deepEqual(seeded.grip, { kind: 'handle', handle: 'radius' });
	assert.equal(seeded.component.type, 'radial');
	if (seeded.component.type !== 'radial') return;
	assert.equal(seeded.component.id, 'component-9');
	assert.equal(seeded.component.operation, 'subtract');
	assert.equal(seeded.component.feather, 0.8);
	assert.deepEqual(seeded.component.center, { x: 0.4, y: 0.6 });
	assert.equal(seeded.component.radiusX, MIN_GRADIENT_EXTENT);
});

test('refuses to seed outside the image or into a mask of another kind', () => {
	const mask = createEditMask('mask-3', 'linear');
	assert.equal(seedGizmoComponent('linear', mask, { x: -1, y: 500 }, image), null);
	assert.equal(seedGizmoComponent('linear', mask, { x: 500, y: 1001 }, image), null);
	assert.equal(seedGizmoComponent('radial', mask, { x: 500, y: 500 }, image), null);
});
