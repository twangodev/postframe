import assert from 'node:assert/strict';
import test from 'node:test';

import { DevelopHistory } from '../src/lib/develop-history.ts';
import { defaultDevelopSettings } from '../src/lib/develop-settings.ts';

test('records a committed gesture as one reversible develop edit', () => {
	const history = new DevelopHistory();
	const before = defaultDevelopSettings();
	const after = { ...before, exposure: 1.25 };

	assert.equal(history.commit({ label: 'exposure +1.25 EV', before, after }), true);
	assert.deepEqual(history.labels, ['exposure +1.25 EV']);
	assert.deepEqual(history.undo(), before);
	assert.equal(history.canUndo, false);
	assert.equal(history.canRedo, true);
	assert.deepEqual(history.redo(), after);
	assert.equal(history.canUndo, true);
});

test('ignores no-op edits and clears redo after a new edit', () => {
	const history = new DevelopHistory();
	const neutral = defaultDevelopSettings();
	const raised = { ...neutral, shadows: 40 };
	const lowered = { ...neutral, shadows: -30 };

	assert.equal(history.commit({ label: 'no-op', before: neutral, after: neutral }), false);
	history.commit({ label: 'raised', before: neutral, after: raised });
	history.undo();
	history.commit({ label: 'lowered', before: neutral, after: lowered });
	assert.equal(history.canRedo, false);
	assert.deepEqual(history.labels, ['lowered']);
});
