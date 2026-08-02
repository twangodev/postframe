import assert from 'node:assert/strict';
import test from 'node:test';

import { libraryManifestSchema } from '../src/lib/library-schema.ts';

const photo = {
	id: 'photo-one',
	name: 'frame.dng',
	importedAt: 1,
	kind: 'raw' as const,
	frames: [
		{
			raw: {
				id: 'asset-one',
				storageName: 'asset-one.dng',
				name: 'frame.dng',
				contentHash: '0'.repeat(64),
				source: {
					kind: 'raw' as const,
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
	thumbnailStorageName: null,
	metadata: null,
	width: 1,
	height: 1,
	rating: 0,
	flagged: false,
	rejected: false,
	colorLabel: 'none' as const,
	stackId: null
};

function library() {
	return {
		version: 1 as const,
		createdAt: 1,
		updatedAt: 1,
		photos: [photo],
		collections: [
			{
				id: 'collection-one',
				name: 'portraits',
				createdAt: 1,
				updatedAt: 1,
				photoIds: [photo.id]
			}
		],
		stacks: []
	};
}

test('stores collection membership as photo references', () => {
	assert.deepEqual(libraryManifestSchema.parse(library()).collections[0]?.photoIds, [photo.id]);
});

test('rejects collection members outside the library', () => {
	const manifest = library();
	manifest.collections[0]!.photoIds = ['photo-missing'];
	assert.equal(libraryManifestSchema.safeParse(manifest).success, false);
});

test('rejects duplicate collection members', () => {
	const manifest = library();
	manifest.collections[0]!.photoIds = [photo.id, photo.id];
	assert.equal(libraryManifestSchema.safeParse(manifest).success, false);
});
