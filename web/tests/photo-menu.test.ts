import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEditDocument } from '../src/lib/edit-document.ts';
import type { MenuAction, MenuEntry, MenuSubmenu } from '../src/lib/menu.ts';
import {
	contextTargets,
	photoContextMenu,
	photoMenu,
	type PhotoMenuAction
} from '../src/lib/photo-menu.ts';
import type { Photo, PhotoCollection, PhotoStack } from '../src/lib/workspace.svelte.ts';

const photo = (id: string, overrides: Partial<Photo> = {}): Photo => ({
	id,
	name: `${id}.jpg`,
	extension: 'jpg',
	src: null,
	kind: 'display',
	frames: [],
	bracketDetection: null,
	thumbnailStorageName: null,
	metadata: null,
	size: 0,
	width: null,
	height: null,
	captured: '',
	importedAt: 0,
	rating: 0,
	flagged: false,
	rejected: false,
	colorLabel: 'none',
	stackId: null,
	edit: defaultEditDocument(id),
	...overrides
});

const collection = (id: string, photoIds: string[] = []): PhotoCollection => ({
	id,
	name: id,
	createdAt: 0,
	updatedAt: 0,
	photoIds
});

const stack = (id: string, photoIds: string[]): PhotoStack => ({
	id,
	name: id,
	photoIds,
	collapsed: true
});

const menu = (targets: Photo[], overrides: Partial<Parameters<typeof photoMenu>[0]> = {}) =>
	photoMenu({ targets, stacks: [], collections: [], ...overrides });

type Entry = MenuEntry<PhotoMenuAction>;

const labels = (entries: Entry[]) =>
	entries.map((entry) => (entry.kind === 'separator' ? '—' : entry.label));

const action = (entries: Entry[], label: string) => {
	const entry = entries.find(
		(candidate) => candidate.kind !== 'separator' && candidate.label === label
	);
	assert.ok(entry, `missing entry ${label}`);
	return entry as MenuAction<PhotoMenuAction>;
};

const submenu = (entries: Entry[], label: string) =>
	action(entries, label) as unknown as MenuSubmenu<PhotoMenuAction>;

test('single photo menu has the standard structure and order', () => {
	const entries = menu([photo('p1')], { collections: [collection('c1')] });
	assert.deepEqual(labels(entries), [
		'open in editor',
		'—',
		'flag photo',
		'rating',
		'color label',
		'add to collection',
		'group into stack',
		'—',
		'remove from library…'
	]);
	assert.deepEqual(action(entries, 'open in editor').action, { type: 'edit' });
	assert.deepEqual(action(entries, 'remove from library…').action, { type: 'remove' });
});

test('flag entry reflects and inverts the target state', () => {
	assert.deepEqual(action(menu([photo('p1')]), 'flag photo').action, {
		type: 'flag',
		flagged: true
	});
	const flagged = menu([photo('p1', { flagged: true }), photo('p2', { flagged: true })]);
	assert.deepEqual(action(flagged, 'remove flag').action, { type: 'flag', flagged: false });
	const mixed = menu([photo('p1', { flagged: true }), photo('p2')]);
	assert.deepEqual(action(mixed, 'flag photos').action, { type: 'flag', flagged: true });
});

test('rating submenu checks the shared rating only', () => {
	const rated = submenu(menu([photo('p1', { rating: 3 })]), 'rating');
	assert.deepEqual(
		rated.items.map((item) => item.kind === 'action' && [item.label, item.checked ?? false]),
		[
			['none', false],
			['★', false],
			['★★', false],
			['★★★', true],
			['★★★★', false],
			['★★★★★', false]
		]
	);
	assert.deepEqual(rated.items[2], {
		kind: 'action',
		label: '★★',
		action: { type: 'rate', rating: 2 },
		checked: false
	});
	const mixed = submenu(menu([photo('p1', { rating: 3 }), photo('p2', { rating: 1 })]), 'rating');
	assert.ok(mixed.items.every((item) => item.kind === 'action' && !item.checked));
});

test('color label submenu checks the shared label', () => {
	const entries = submenu(menu([photo('p1', { colorLabel: 'red' })]), 'color label');
	assert.deepEqual(entries.items[1], {
		kind: 'action',
		label: 'red',
		action: { type: 'label', label: 'red' },
		checked: true
	});
	assert.deepEqual(entries.items[0].kind === 'action' && entries.items[0].checked, false);
});

test('collection submenu checks full membership and toggles it', () => {
	const collections = [collection('c1', ['p1', 'p2']), collection('c2', ['p1'])];
	const entries = submenu(menu([photo('p1'), photo('p2')], { collections }), 'add to collection');
	assert.deepEqual(entries.items, [
		{
			kind: 'action',
			label: 'c1',
			action: { type: 'collection', collectionId: 'c1', member: false },
			checked: true
		},
		{
			kind: 'action',
			label: 'c2',
			action: { type: 'collection', collectionId: 'c2', member: true },
			checked: false
		}
	]);
});

test('collection submenu offers creation when no collections exist', () => {
	const entries = submenu(menu([photo('p1')]), 'add to collection');
	assert.deepEqual(entries.items, [
		{ kind: 'action', label: 'create collection…', action: { type: 'create-collection' } }
	]);
});

test('stack entry ungroups a shared stack and gates grouping on target count', () => {
	const shared = stack('s1', ['p1', 'p2']);
	const grouped = menu([photo('p1', { stackId: 's1' }), photo('p2', { stackId: 's1' })], {
		stacks: [shared]
	});
	assert.deepEqual(action(grouped, 'ungroup stack').action, {
		type: 'ungroup-stack',
		stackId: 's1'
	});
	assert.equal(action(menu([photo('p1')]), 'group into stack').disabled, true);
	const pair = menu([photo('p1'), photo('p2')]);
	assert.equal(action(pair, 'group into stack').disabled, false);
});

test('remove label counts multiple targets', () => {
	const entries = menu([photo('p1'), photo('p2'), photo('p3')]);
	assert.deepEqual(action(entries, 'remove 3 photos from library…').action, { type: 'remove' });
});

test('contextTargets keeps a selection the photo belongs to', () => {
	assert.deepEqual(contextTargets('p2', ['p1', 'p2']), {
		targetIds: ['p1', 'p2'],
		moveSelection: false
	});
	assert.deepEqual(contextTargets('p3', ['p1', 'p2']), {
		targetIds: ['p3'],
		moveSelection: true
	});
});

test('stack entry offers grouping when targets span stacks or the stack is unknown', () => {
	const stacks = [stack('s1', ['p1']), stack('s2', ['p2'])];
	const spanning = menu([photo('p1', { stackId: 's1' }), photo('p2', { stackId: 's2' })], {
		stacks
	});
	assert.deepEqual(action(spanning, 'group into stack').action, { type: 'group-stack' });
	const unknown = menu([photo('p1', { stackId: 'gone' }), photo('p2', { stackId: 'gone' })]);
	assert.deepEqual(action(unknown, 'group into stack').action, { type: 'group-stack' });
});

test('photoContextMenu targets the whole selection when the photo is selected', () => {
	const photos = [photo('p1'), photo('p2'), photo('p3')];
	const result = photoContextMenu(
		{ photos, stacks: [], collections: [], selectedIds: ['p1', 'p2'] },
		'p2'
	);
	assert.deepEqual(result.targetIds, ['p1', 'p2']);
	assert.equal(result.moveSelection, false);
	assert.ok(labels(result.items).includes('remove 2 photos from library…'));
});

test('photoContextMenu retargets an unselected photo and asks to move the selection', () => {
	const photos = [photo('p1'), photo('p2'), photo('p3')];
	const result = photoContextMenu(
		{ photos, stacks: [], collections: [], selectedIds: ['p1'] },
		'p3'
	);
	assert.deepEqual(result.targetIds, ['p3']);
	assert.equal(result.moveSelection, true);
	assert.ok(labels(result.items).includes('remove from library…'));
});

test('photoContextMenu derives the shared stack from its targets', () => {
	const photos = [photo('p1', { stackId: 's1' }), photo('p2', { stackId: 's1' }), photo('p3')];
	const stacks = [stack('s1', ['p1', 'p2'])];
	const shared = photoContextMenu(
		{ photos, stacks, collections: [], selectedIds: ['p1', 'p2'] },
		'p1'
	);
	assert.deepEqual(action(shared.items, 'ungroup stack').action, {
		type: 'ungroup-stack',
		stackId: 's1'
	});
	const mixed = photoContextMenu(
		{ photos, stacks, collections: [], selectedIds: ['p2', 'p3'] },
		'p2'
	);
	assert.deepEqual(action(mixed.items, 'group into stack').action, { type: 'group-stack' });
});
