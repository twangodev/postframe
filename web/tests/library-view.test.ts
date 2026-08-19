import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEditDocument } from '../src/lib/edit-document.ts';
import {
	librarySourceCounts,
	sameSource,
	visibleLibraryPhotos,
	type LibraryQuery,
	type LibrarySource
} from '../src/lib/library-view.ts';
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

const stack = (id: string, photoIds: string[], collapsed = true): PhotoStack => ({
	id,
	name: id,
	photoIds,
	collapsed
});

const library = (
	photos: Photo[],
	stacks: PhotoStack[] = [],
	collections: PhotoCollection[] = []
) => ({ photos, stacks, collections });

const query = (overrides: Partial<LibraryQuery> = {}): LibraryQuery => ({
	search: '',
	source: { kind: 'all' },
	sort: 'capture',
	recentCutoff: 0,
	...overrides
});

const ids = (photos: Photo[]) => photos.map(({ id }) => id);

test('search matches photo names case-insensitively', () => {
	const photos = [photo('sunset'), photo('Sunrise'), photo('moon')];
	assert.deepEqual(ids(visibleLibraryPhotos(library(photos), query({ search: ' SUN ' }))), [
		'sunset',
		'Sunrise'
	]);
});

test('recent source keeps photos imported at or after the cutoff', () => {
	const photos = [photo('old', { importedAt: 4 }), photo('new', { importedAt: 5 })];
	const visible = visibleLibraryPhotos(
		library(photos),
		query({ source: { kind: 'recent' }, recentCutoff: 5 })
	);
	assert.deepEqual(ids(visible), ['new']);
});

test('favorites source keeps flagged photos', () => {
	const photos = [photo('plain'), photo('starred', { flagged: true })];
	const visible = visibleLibraryPhotos(library(photos), query({ source: { kind: 'favorites' } }));
	assert.deepEqual(ids(visible), ['starred']);
});

test('collection source keeps members and ignores an unknown collection', () => {
	const photos = [photo('inside'), photo('outside')];
	const collections = [collection('c1', ['inside'])];
	const member: LibrarySource = { kind: 'collection', collectionId: 'c1' };
	const missing: LibrarySource = { kind: 'collection', collectionId: 'gone' };
	assert.deepEqual(
		ids(visibleLibraryPhotos(library(photos, [], collections), query({ source: member }))),
		['inside']
	);
	assert.deepEqual(
		ids(visibleLibraryPhotos(library(photos, [], collections), query({ source: missing }))),
		['inside', 'outside']
	);
});

test('a collapsed stack shows only its first visible member', () => {
	const photos = [photo('a', { stackId: 's1' }), photo('b', { stackId: 's1' }), photo('loose')];
	const collapsed = library(photos, [stack('s1', ['a', 'b'])]);
	assert.deepEqual(ids(visibleLibraryPhotos(collapsed, query())), ['a', 'loose']);

	const filtered = visibleLibraryPhotos(collapsed, query({ search: 'b' }));
	assert.deepEqual(ids(filtered), ['b']);

	const expanded = library(photos, [stack('s1', ['a', 'b'], false)]);
	assert.deepEqual(ids(visibleLibraryPhotos(expanded, query())), ['a', 'b', 'loose']);
});

test('sorts by capture time, name or rating', () => {
	const photos = [
		photo('c', { captured: '3', rating: 1 }),
		photo('a', { captured: '2', rating: 5 }),
		photo('b', { captured: '1', rating: 3 })
	];
	assert.deepEqual(ids(visibleLibraryPhotos(library(photos), query({ sort: 'capture' }))), [
		'b',
		'a',
		'c'
	]);
	assert.deepEqual(ids(visibleLibraryPhotos(library(photos), query({ sort: 'name' }))), [
		'a',
		'b',
		'c'
	]);
	assert.deepEqual(ids(visibleLibraryPhotos(library(photos), query({ sort: 'rating' }))), [
		'a',
		'b',
		'c'
	]);
});

test('sameSource compares kinds and collection identity', () => {
	assert.equal(sameSource({ kind: 'all' }, { kind: 'all' }), true);
	assert.equal(sameSource({ kind: 'all' }, { kind: 'recent' }), false);
	assert.equal(sameSource({ kind: 'favorites' }, { kind: 'favorites' }), true);
	assert.equal(
		sameSource(
			{ kind: 'collection', collectionId: 'c1' },
			{ kind: 'collection', collectionId: 'c1' }
		),
		true
	);
	assert.equal(
		sameSource(
			{ kind: 'collection', collectionId: 'c1' },
			{ kind: 'collection', collectionId: 'c2' }
		),
		false
	);
	assert.equal(sameSource({ kind: 'collection', collectionId: 'c1' }, { kind: 'all' }), false);
});

test('librarySourceCounts tallies all, recent and favorites', () => {
	const photos = [
		photo('old', { importedAt: 1 }),
		photo('new', { importedAt: 9, flagged: true }),
		photo('newer', { importedAt: 10 })
	];
	assert.deepEqual(librarySourceCounts(photos, 9), { all: 3, recent: 2, favorites: 1 });
});
