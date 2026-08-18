import assert from 'node:assert/strict';
import test from 'node:test';

import { EDITOR_MENUS, type EditorMenuEntry } from '../src/lib/editor-menu.ts';

function editMenuItems() {
	const menu = EDITOR_MENUS.find(({ id }) => id === 'edit');
	assert.ok(menu, 'the edit menu exists');
	return menu.items;
}

function action(items: EditorMenuEntry[], name: string) {
	const entry = items.find((item) => item.kind === 'action' && item.action === name);
	assert.ok(entry && entry.kind === 'action', `${name} is an edit menu action`);
	return entry;
}

test('the edit menu carries the settings workflow actions with their shortcuts', () => {
	const items = editMenuItems();
	assert.equal(action(items, 'copy-settings').shortcut, '⇧⌘C');
	assert.equal(action(items, 'paste-settings').shortcut, '⇧⌘V');
	assert.equal(action(items, 'sync-settings').shortcut, '⇧⌘S');
	assert.match(action(items, 'copy-settings').label, /…$/);
	assert.match(action(items, 'sync-settings').label, /…$/);
});

test('the edit menu no longer stubs copy and paste', () => {
	const todos = editMenuItems().flatMap((item) => (item.kind === 'todo' ? [item.label] : []));
	assert.ok(todos.includes('cut'));
	assert.ok(!todos.includes('copy'));
	assert.ok(!todos.includes('paste'));
});
