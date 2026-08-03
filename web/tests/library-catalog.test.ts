import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import { LibraryCatalog } from '../src/lib/library-catalog.ts';
import type { LibraryManifest } from '../src/lib/library-schema.ts';

function manifest(): LibraryManifest {
	return {
		version: 1,
		createdAt: 1,
		updatedAt: 2,
		photos: [
			{
				id: 'photo-one',
				name: 'frame.dng',
				importedAt: 1,
				kind: 'raw',
				frames: [
					{
						raw: {
							id: 'asset-one',
							storageName: 'asset-one.dng',
							name: 'frame.dng',
							contentHash: '0'.repeat(64),
							source: {
								kind: 'raw',
								format: 'dng',
								mediaType: 'image/x-adobe-dng',
								size: 1,
								lastModified: 1
							}
						},
						display: null,
						filenameExposureHint: null
					}
				],
				bracketDetection: null,
				thumbnailStorageName: 'photo-one.jpg',
				metadata: null,
				width: 1,
				height: 1,
				rating: 0,
				flagged: false,
				rejected: false,
				colorLabel: 'none',
				stackId: null
			}
		],
		collections: [
			{
				id: 'collection-one',
				name: 'portraits',
				createdAt: 1,
				updatedAt: 2,
				photoIds: ['photo-one']
			}
		],
		stacks: []
	};
}

test('round-trips a normalized library catalog', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const expected = manifest();
		await catalog.saveLibrary(expected);
		assert.deepEqual(await catalog.loadLibrary(), expected);
		assert.equal(await catalog.database.assets.count(), 1);
		assert.equal(await catalog.database.collectionPhotos.count(), 1);
	} finally {
		await catalog.clear();
	}
});

test('rolls back the catalog when a collection name conflicts', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const original = manifest();
		await catalog.saveLibrary(original);
		const conflicting = manifest();
		conflicting.collections.push({
			...conflicting.collections[0]!,
			id: 'collection-two',
			name: ' PORTRAITS '
		});

		await assert.rejects(catalog.saveLibrary(conflicting));
		assert.deepEqual(await catalog.loadLibrary(), original);
	} finally {
		await catalog.clear();
	}
});

test('resolves a repeated import to the existing photo by content', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const library = manifest();
		await catalog.saveLibrary(library);
		const duplicate = structuredClone(library.photos[0]!);
		duplicate.id = 'photo-two';
		duplicate.frames[0]!.raw!.id = 'asset-two';
		duplicate.frames[0]!.raw!.storageName = 'asset-two.dng';

		const resolution = await catalog.resolveImports([duplicate]);
		assert.deepEqual(resolution.additions, []);
		assert.equal(resolution.photoIds.get('photo-two'), 'photo-one');
	} finally {
		await catalog.clear();
	}
});

test('deduplicates repeated content within one import batch', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const first = manifest().photos[0]!;
		const duplicate = structuredClone(first);
		duplicate.id = 'photo-two';
		duplicate.frames[0]!.raw!.id = 'asset-two';
		duplicate.frames[0]!.raw!.storageName = 'asset-two.dng';

		const resolution = await catalog.resolveImports([first, duplicate]);
		assert.deepEqual(resolution.additions, [first]);
		assert.equal(resolution.photoIds.get('photo-one'), 'photo-one');
		assert.equal(resolution.photoIds.get('photo-two'), 'photo-one');
	} finally {
		await catalog.clear();
	}
});

test('allows one asset content hash in distinct photo compositions', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const library = manifest();
		const pair = structuredClone(library.photos[0]!);
		pair.id = 'photo-two';
		pair.kind = 'raw-pair';
		pair.name = 'frame.jpg';
		pair.thumbnailStorageName = 'photo-two.jpg';
		pair.frames[0]!.raw!.id = 'asset-two';
		pair.frames[0]!.raw!.storageName = 'asset-two.dng';
		pair.frames[0]!.display = {
			id: 'asset-three',
			storageName: 'asset-three.jpg',
			name: 'frame.jpg',
			contentHash: '1'.repeat(64),
			source: {
				kind: 'image',
				format: 'jpg',
				mediaType: 'image/jpeg',
				size: 1,
				lastModified: 1
			}
		};
		library.photos.push(pair);

		await catalog.saveLibrary(library);
		assert.equal((await catalog.loadLibrary())?.photos.length, 2);
		assert.equal(
			await catalog.database.assets.where('contentHash').equals('0'.repeat(64)).count(),
			2
		);
	} finally {
		await catalog.clear();
	}
});

test('updates photo and collection state without replacing the library', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		const library = manifest();
		await catalog.saveLibrary(library);
		const photo = structuredClone(library.photos[0]!);
		photo.rating = 4;
		photo.flagged = true;
		await catalog.updatePhotoState(photo);
		await catalog.saveCollection({ ...library.collections[0]!, photoIds: [], updatedAt: 3 });

		const updated = await catalog.loadLibrary();
		assert.equal(updated?.photos[0]?.rating, 4);
		assert.equal(updated?.photos[0]?.flagged, true);
		assert.deepEqual(updated?.collections[0]?.photoIds, []);
		assert.equal(await catalog.database.assets.count(), 1);
	} finally {
		await catalog.clear();
	}
});

test('queues asset deletion with the photo catalog transaction', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	try {
		await catalog.saveLibrary(manifest());
		const deletions = await catalog.deletePhoto('photo-one');

		assert.deepEqual(
			deletions.map(({ kind, storageName }) => ({ kind, storageName })),
			[
				{ kind: 'original', storageName: 'asset-one.dng' },
				{ kind: 'thumbnail', storageName: 'photo-one.jpg' },
				{ kind: 'edit', storageName: 'photo-one.json' },
				{ kind: 'derived', storageName: 'render-v1-photo-one.pfc' }
			]
		);
		assert.equal((await catalog.loadLibrary())?.photos.length, 0);
		assert.equal((await catalog.loadLibrary())?.collections[0]?.photoIds.length, 0);
		assert.equal((await catalog.pendingDeletions()).length, 4);
		await catalog.completeDeletions(deletions);
		assert.equal((await catalog.pendingDeletions()).length, 0);
	} finally {
		await catalog.clear();
	}
});

test('deletes the local catalog', async () => {
	const name = `postframe-test-${crypto.randomUUID()}`;
	const catalog = new LibraryCatalog(name);
	await catalog.saveLibrary(manifest());
	await catalog.clear();

	const reopened = new LibraryCatalog(name);
	try {
		assert.equal(await reopened.loadLibrary(), null);
	} finally {
		await reopened.clear();
	}
});
