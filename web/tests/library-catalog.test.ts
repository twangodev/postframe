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
