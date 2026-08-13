import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEditDocument } from '../src/lib/edit-document.ts';
import { removePhotos, type LibraryState } from '../src/lib/photo-removal.ts';
import type { Photo } from '../src/lib/workspace.svelte.ts';

const photo = (id: string, stackId: string | null = null): Photo => ({
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
	stackId,
	edit: defaultEditDocument(id)
});

const state = (overrides: Partial<LibraryState> = {}): LibraryState => ({
	photos: [photo('a'), photo('b'), photo('c')],
	collections: [],
	stacks: [],
	selectedIds: [],
	activePhotoId: null,
	...overrides
});

test('removes photos and prunes collection membership', () => {
	const next = removePhotos(
		state({
			collections: [
				{ id: 'c1', name: 'c1', createdAt: 0, updatedAt: 0, photoIds: ['a', 'b'] },
				{ id: 'c2', name: 'c2', createdAt: 0, updatedAt: 0, photoIds: ['c'] }
			]
		}),
		['b']
	);
	assert.deepEqual(
		next.photos.map(({ id }) => id),
		['a', 'c']
	);
	assert.deepEqual(
		next.collections.map(({ photoIds }) => photoIds),
		[['a'], ['c']]
	);
});

test('dissolves stacks left with fewer than two members', () => {
	const next = removePhotos(
		state({
			photos: [
				photo('a', 's1'),
				photo('b', 's1'),
				photo('c', 's2'),
				photo('d', 's2'),
				photo('e', 's2')
			],
			stacks: [
				{ id: 's1', name: 's1', photoIds: ['a', 'b'], collapsed: true },
				{ id: 's2', name: 's2', photoIds: ['c', 'd', 'e'], collapsed: true }
			]
		}),
		['b', 'e']
	);
	assert.deepEqual(next.stacks, [{ id: 's2', name: 's2', photoIds: ['c', 'd'], collapsed: true }]);
	assert.deepEqual(
		next.photos.map(({ id, stackId }) => [id, stackId]),
		[
			['a', null],
			['c', 's2'],
			['d', 's2']
		]
	);
});

test('moves the active photo to the next surviving neighbor', () => {
	const next = removePhotos(state({ selectedIds: ['b'], activePhotoId: 'b' }), ['b']);
	assert.equal(next.activePhotoId, 'c');
	assert.deepEqual(next.selectedIds, ['c']);
});

test('falls back to the previous neighbor at the end of the library', () => {
	const next = removePhotos(state({ selectedIds: ['b', 'c'], activePhotoId: 'c' }), ['b', 'c']);
	assert.equal(next.activePhotoId, 'a');
	assert.deepEqual(next.selectedIds, ['a']);
});

test('keeps a surviving active photo and prunes the selection', () => {
	const next = removePhotos(state({ selectedIds: ['a', 'b'], activePhotoId: 'a' }), ['b']);
	assert.equal(next.activePhotoId, 'a');
	assert.deepEqual(next.selectedIds, ['a']);
});

test('empties cleanly when every photo is removed', () => {
	const next = removePhotos(state({ selectedIds: ['a', 'b', 'c'], activePhotoId: 'b' }), [
		'a',
		'b',
		'c'
	]);
	assert.deepEqual(next.photos, []);
	assert.equal(next.activePhotoId, null);
	assert.deepEqual(next.selectedIds, []);
});
