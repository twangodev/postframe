import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EDIT_DOCUMENT_VERSION,
	createEditMask,
	defaultEditDocument,
	editDocumentStorageName,
	editDocumentSchema,
	editMaskSchema,
	parseEditDocument
} from '../src/lib/edit-document.ts';
import { defaultDevelopSettings } from '../src/lib/develop-settings.ts';

test('creates an independent versioned non-destructive document', () => {
	const first = defaultEditDocument('photo-one');
	const second = defaultEditDocument('photo-one');
	assert.equal(first.version, EDIT_DOCUMENT_VERSION);
	assert.equal(first.photoId, 'photo-one');
	assert.deepEqual(first.geometry, {
		rotation: 0,
		flipHorizontal: false,
		flipVertical: false,
		crop: null
	});
	assert.notEqual(first, second);
	assert.notEqual(first.adjustments.light, second.adjustments.light);
	assert.equal(editDocumentStorageName('photo-one'), 'photo-one.json');
});

test('migrates version-one develop settings without changing their light values', () => {
	const legacy = { ...defaultDevelopSettings(), exposure: 1.25, highlights: -30 };
	const migrated = parseEditDocument(legacy, 'photo-one');
	assert.equal(migrated.version, EDIT_DOCUMENT_VERSION);
	assert.equal(migrated.photoId, 'photo-one');
	assert.equal(migrated.adjustments.light.exposure, 1.25);
	assert.equal(migrated.adjustments.light.highlights, -30);
});

test('preserves global edits while removing version-two visual masks', () => {
	const previous = {
		...defaultEditDocument('photo-one'),
		version: 2,
		adjustments: {
			light: { ...defaultEditDocument('photo-one').adjustments.light, exposure: 0.75 }
		},
		masks: [{ id: 'visual-only' }]
	};
	const migrated = parseEditDocument(previous, 'photo-one');
	assert.equal(migrated.adjustments.light.exposure, 0.75);
	assert.deepEqual(migrated.masks, []);
});

test('preserves version-three masks with neutral edge settings', () => {
	const mask = createEditMask('mask-one', 'subject');
	const { edge: _, ...versionThreeMask } = mask;
	const previous = {
		...defaultEditDocument('photo-one'),
		version: 3,
		masks: [versionThreeMask]
	};
	const migrated = parseEditDocument(previous, 'photo-one');
	assert.equal(migrated.version, EDIT_DOCUMENT_VERSION);
	assert.deepEqual(migrated.masks[0], mask);
});

test('rejects mismatched photos, duplicate masks, and invalid normalized crops', () => {
	const document = defaultEditDocument('photo-one');
	assert.throws(() => parseEditDocument({ ...document, photoId: 'photo-two' }, 'photo-one'));
	const mask = createEditMask('mask-one', 'brush');
	assert.deepEqual(mask.components, []);
	assert.equal(editDocumentSchema.safeParse({ ...document, masks: [mask, mask] }).success, false);
	assert.equal(
		editDocumentSchema.safeParse({
			...document,
			geometry: { ...document.geometry, crop: { x: 0.75, y: 0, width: 0.5, height: 1 } }
		}).success,
		false
	);
	const object = createEditMask('object-one', 'object');
	object.components.push({
		id: 'component-one',
		type: 'ai-object',
		operation: 'add',
		modelVersion: 'model-one',
		alternatives: { index: 2, count: 2 },
		prompts: [{ label: 'foreground', points: [{ x: 0.5, y: 0.5 }] }],
		raster: null
	});
	assert.equal(editDocumentSchema.safeParse({ ...document, masks: [object] }).success, false);
});

test('carries version-four documents forward unchanged', () => {
	const mask = createEditMask('mask-one', 'subject');
	const previous = { ...defaultEditDocument('photo-one'), version: 4, masks: [mask] };
	const migrated = parseEditDocument(previous, 'photo-one');
	assert.equal(migrated.version, EDIT_DOCUMENT_VERSION);
	assert.deepEqual(migrated.masks, [mask]);
	assert.throws(() => parseEditDocument({ ...previous, photoId: 'photo-two' }, 'photo-one'));
});

test('carries version-five documents forward unchanged', () => {
	const mask = createEditMask('mask-one', 'linear');
	const previous = { ...defaultEditDocument('photo-one'), version: 5, masks: [mask] };
	const migrated = parseEditDocument(previous, 'photo-one');
	assert.equal(migrated.version, EDIT_DOCUMENT_VERSION);
	assert.deepEqual(migrated.masks, [mask]);
	assert.throws(() => parseEditDocument({ ...previous, photoId: 'photo-two' }, 'photo-one'));
});

test('accepts gradient components carrying their geometry', () => {
	const linear = createEditMask('mask-linear', 'linear');
	linear.components.push({
		id: 'component-linear',
		type: 'linear',
		operation: 'add',
		start: { x: 0.2, y: 0.8 },
		end: { x: 0.9, y: 0.1 },
		raster: null
	});
	const radial = createEditMask('mask-radial', 'radial');
	radial.components.push({
		id: 'component-radial',
		type: 'radial',
		operation: 'add',
		center: { x: 0.5, y: 0.5 },
		radius: 0.25,
		feather: 0.5,
		raster: null
	});
	const document = { ...defaultEditDocument('photo-one'), masks: [linear, radial] };
	assert.deepEqual(parseEditDocument(document, 'photo-one').masks, [linear, radial]);
	assert.equal(
		editMaskSchema.safeParse({
			...radial,
			components: [{ ...radial.components[0], radius: 1.5 }]
		}).success,
		false
	);
});

test('accepts detected-subject components with their originating box', () => {
	const mask = createEditMask('mask-one', 'subject');
	mask.name = 'person 1';
	mask.components.push({
		id: 'component-one',
		type: 'ai-instance',
		operation: 'add',
		label: 'person',
		box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
		modelVersion: 'pack-version',
		alternatives: { index: 1, count: 3 },
		raster: null
	});
	const document = { ...defaultEditDocument('photo-one'), masks: [mask] };
	assert.deepEqual(parseEditDocument(document, 'photo-one').masks, [mask]);
	assert.equal(
		editMaskSchema.safeParse({
			...mask,
			components: [{ ...mask.components[0], box: { x: 0.75, y: 0, width: 0.5, height: 0.5 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...mask,
			components: [{ ...mask.components[0], alternatives: { index: 3, count: 3 } }]
		}).success,
		false
	);
});
