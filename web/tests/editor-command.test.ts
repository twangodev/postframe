import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditMask,
	defaultEditDocument,
	type MaskComponent
} from '../src/lib/edit-document.ts';
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
	assert.equal(created.invalidation, 'render');

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

test('updates local light without changing global development settings', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'subject'));
	const changed = applyEditorCommand(document, {
		type: 'mask.light.set',
		maskId: 'mask-one',
		control: 'exposure',
		value: 1.25
	});
	assert.ok(changed);
	assert.equal(changed.invalidation, 'render');
	assert.equal(changed.document.masks[0]?.adjustments.light.exposure, 1.25);
	assert.equal(changed.document.adjustments.light.exposure, 0);
});

test('adds and replaces persistent mask components by id', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'object'));
	const component = {
		id: 'component-one',
		type: 'ai-object',
		operation: 'add',
		modelVersion: 'model-one',
		prompts: [{ label: 'foreground', points: [{ x: 0.5, y: 0.5 }] }],
		raster: {
			storageName: 'photo-one-component-one.mask',
			width: 2,
			height: 2,
			digest: '0'.repeat(64)
		}
	} satisfies MaskComponent;
	const added = applyEditorCommand(document, {
		type: 'mask.component.set',
		maskId: 'mask-one',
		component
	});
	assert.ok(added);
	assert.deepEqual(added.document.masks[0]?.components, [component]);

	const replacement = {
		...component,
		prompts: [...component.prompts, { label: 'background' as const, points: [{ x: 0, y: 0 }] }]
	};
	const replaced = applyEditorCommand(added.document, {
		type: 'mask.component.set',
		maskId: 'mask-one',
		component: replacement
	});
	assert.ok(replaced);
	assert.deepEqual(replaced.document.masks[0]?.components, [replacement]);
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
