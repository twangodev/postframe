import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditMask, defaultEditDocument } from '../src/lib/edit-document.ts';
import { applyEditorCommand } from '../src/lib/editor-command.ts';

test('applies light commands immutably with render invalidation', () => {
	const before = defaultEditDocument('photo-one');
	const result = applyEditorCommand(before, {
		type: 'light.set',
		control: 'contrast',
		value: 35
	});
	assert.ok(result);
	assert.equal(result.document.adjustments.light.contrast, 35);
	assert.equal(result.invalidation, 'render');
	assert.equal(result.label, 'contrast +35');
	assert.equal(before.adjustments.light.contrast, 0);
	assert.equal(
		applyEditorCommand(result.document, {
			type: 'light.set',
			control: 'contrast',
			value: 35
		}),
		null
	);
});

test('creates, hides, and removes masks through deterministic commands', () => {
	const before = defaultEditDocument('photo-one');
	const created = applyEditorCommand(before, {
		type: 'mask.create',
		mask: createEditMask('mask-one', 'radial')
	});
	assert.ok(created);
	assert.equal(created.document.masks[0]?.name, 'radial gradient');

	const hidden = applyEditorCommand(created.document, {
		type: 'mask.visibility',
		maskId: 'mask-one',
		visible: false
	});
	assert.ok(hidden);
	assert.equal(hidden.document.masks[0]?.visible, false);

	const removed = applyEditorCommand(hidden.document, {
		type: 'mask.delete',
		maskId: 'mask-one'
	});
	assert.ok(removed);
	assert.deepEqual(removed.document.masks, []);
});

test('validates geometry commands before committing them', () => {
	const document = defaultEditDocument('photo-one');
	assert.throws(() => applyEditorCommand(document, { type: 'geometry.rotate', rotation: 181 }));
	assert.throws(() =>
		applyEditorCommand(document, {
			type: 'geometry.crop',
			crop: { x: 0.8, y: 0, width: 0.5, height: 1 }
		})
	);
	const flipped = applyEditorCommand(document, {
		type: 'geometry.flip',
		axis: 'horizontal'
	});
	assert.ok(flipped);
	assert.equal(flipped.document.geometry.flipHorizontal, true);
});
