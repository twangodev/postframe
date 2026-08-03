import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EDIT_DOCUMENT_VERSION,
	createEditMask,
	defaultEditDocument,
	editDocumentStorageName,
	editDocumentSchema,
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

test('rejects mismatched photos, duplicate masks, and invalid normalized crops', () => {
	const document = defaultEditDocument('photo-one');
	assert.throws(() => parseEditDocument({ ...document, photoId: 'photo-two' }, 'photo-one'));
	const mask = createEditMask('mask-one', 'brush');
	assert.equal(editDocumentSchema.safeParse({ ...document, masks: [mask, mask] }).success, false);
	assert.equal(
		editDocumentSchema.safeParse({
			...document,
			geometry: { ...document.geometry, crop: { x: 0.75, y: 0, width: 0.5, height: 1 } }
		}).success,
		false
	);
});
