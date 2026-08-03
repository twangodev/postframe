import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEditDocument } from '../src/lib/edit-document.ts';
import { applyEditorCommand } from '../src/lib/editor-command.ts';
import { EditorHistory } from '../src/lib/editor-history.ts';

test('records a committed command as one reversible document edit', () => {
	const history = new EditorHistory();
	const before = defaultEditDocument('photo-one');
	const transition = applyEditorCommand(before, {
		type: 'light.set',
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
		type: 'light.set',
		control: 'shadows',
		value: 40
	});
	assert.ok(raised);
	history.commit(neutral, raised);
	history.undo();

	const lowered = applyEditorCommand(neutral, {
		type: 'light.set',
		control: 'shadows',
		value: -30
	});
	assert.ok(lowered);
	history.commit(neutral, lowered);
	assert.equal(history.canRedo, false);
	assert.deepEqual(history.labels, ['shadows -30']);
});
