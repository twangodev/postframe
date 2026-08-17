import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditMask,
	defaultEditDocument,
	type MaskComponent
} from '../src/lib/edit-document.ts';
import { applyEditorCommand } from '../src/lib/editor-command.ts';
import { EditorHistory } from '../src/lib/editor-history.ts';

test('records a committed command as one reversible document edit', () => {
	const history = new EditorHistory();
	const before = defaultEditDocument('photo-one');
	const transition = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'light',
		control: 'exposure',
		value: 1.25
	});
	assert.ok(transition);

	history.commit(before, transition);
	assert.deepEqual(history.labels, ['exposure +1.25 EV']);
	assert.deepEqual(history.undo(), { document: before, invalidation: 'render' });
	assert.equal(history.canUndo, false);
	assert.equal(history.canRedo, true);
	assert.deepEqual(history.redo(), {
		document: transition.document,
		invalidation: 'render'
	});
	assert.equal(history.canUndo, true);
});

test('clears redo after a new command', () => {
	const history = new EditorHistory();
	const neutral = defaultEditDocument('photo-one');
	const raised = applyEditorCommand(neutral, {
		type: 'adjustment.set',
		group: 'light',
		control: 'shadows',
		value: 40
	});
	assert.ok(raised);
	history.commit(neutral, raised);
	history.undo();

	const lowered = applyEditorCommand(neutral, {
		type: 'adjustment.set',
		group: 'light',
		control: 'shadows',
		value: -30
	});
	assert.ok(lowered);
	history.commit(neutral, lowered);
	assert.equal(history.canRedo, false);
	assert.deepEqual(history.labels, ['shadows -30']);
});

test('reverses a nested mixer edit as one step', () => {
	const history = new EditorHistory();
	const before = defaultEditDocument('photo-one');
	const transition = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'mixer',
		band: 'aqua',
		control: 'luminance',
		value: -30
	});
	assert.ok(transition);

	history.commit(before, transition);
	assert.deepEqual(history.labels, ['aqua luminance -30']);
	assert.deepEqual(history.undo(), { document: before, invalidation: 'render' });
	assert.equal(history.redo()?.document.adjustments.mixer.aqua.luminance, -30);
});

test('records commands containing reactive mask arrays as plain history data', () => {
	const history = new EditorHistory();
	const before = defaultEditDocument('photo-one');
	const mask = createEditMask('mask-one', 'object');
	const component = {
		id: 'component-one',
		type: 'ai-object',
		operation: 'add',
		modelVersion: 'model-one',
		alternatives: { index: 0, count: 3 },
		prompts: [
			{
				label: 'foreground',
				points: new Proxy([{ x: 0.5, y: 0.5 }], {})
			}
		],
		raster: null
	} satisfies MaskComponent;
	mask.components = new Proxy([component], {});
	const transition = applyEditorCommand(before, { type: 'mask.create', mask });
	assert.ok(transition);

	history.commit(before, transition);
	assert.deepEqual(history.redo(), null);
	assert.deepEqual(history.undo(), { document: before, invalidation: 'render' });
});
