import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	AssetStore,
	OriginalWrite,
	StoredFile,
	ThumbnailWrite
} from '../src/lib/asset-store.ts';
import { LibraryCatalog } from '../src/lib/library-catalog.ts';
import { LibraryService } from '../src/lib/library-service.ts';
import type { PhotoCollection, StoredPhoto } from '../src/lib/library-schema.ts';

class MemoryAssetStore {
	readonly originals = new Map<string, File>();
	readonly thumbnails = new Map<string, Blob>();
	readonly edits = new Map<string, Blob>();

	async readEdit(storageName: string) {
		const blob = this.edits.get(storageName);
		return blob ? new File([blob], storageName, { type: blob.type }) : null;
	}

	async writeOriginals(writes: readonly OriginalWrite[]) {
		const created: string[] = [];
		for (const { storageName, file } of writes) {
			if (!this.originals.has(storageName)) created.push(storageName);
			this.originals.set(storageName, file);
		}
		return created;
	}

	async writeThumbnails(writes: readonly ThumbnailWrite[]) {
		const created: string[] = [];
		for (const { storageName, blob } of writes) {
			if (!this.thumbnails.has(storageName)) created.push(storageName);
			this.thumbnails.set(storageName, blob);
		}
		return created;
	}

	async writeEdits(writes: readonly { storageName: string; blob: Blob }[]) {
		const created: string[] = [];
		for (const { storageName, blob } of writes) {
			if (!this.edits.has(storageName)) created.push(storageName);
			this.edits.set(storageName, blob);
		}
		return created;
	}

	async deleteOriginals(storageNames: readonly string[]) {
		for (const storageName of storageNames) this.originals.delete(storageName);
	}

	async deleteThumbnails(storageNames: readonly string[]) {
		for (const storageName of storageNames) this.thumbnails.delete(storageName);
	}

	async deleteEdits(storageNames: readonly string[]) {
		for (const storageName of storageNames) this.edits.delete(storageName);
	}

	async listOriginals(): Promise<StoredFile[]> {
		return [...this.originals].map(([storageName, file]) => ({ storageName, size: file.size }));
	}

	async listThumbnails(): Promise<StoredFile[]> {
		return [...this.thumbnails].map(([storageName, blob]) => ({ storageName, size: blob.size }));
	}

	async listEdits(): Promise<StoredFile[]> {
		return [...this.edits].map(([storageName, blob]) => ({ storageName, size: blob.size }));
	}

	async clearAll() {
		this.originals.clear();
		this.thumbnails.clear();
		this.edits.clear();
	}
}

test('round-trips versioned develop settings', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	const assets = new MemoryAssetStore();
	const service = new LibraryService(catalog, assets as unknown as AssetStore);
	try {
		assert.deepEqual(await service.loadDevelopSettings('photo-one'), {
			version: 1,
			exposure: 0
		});
		await service.saveDevelopSettings('photo-one', { version: 1, exposure: 1.25 });
		assert.deepEqual(await service.loadDevelopSettings('photo-one'), {
			version: 1,
			exposure: 1.25
		});
	} finally {
		await service.clearAll();
	}
});

function storedPhoto(id: string, assetId: string, contentHash: string): StoredPhoto {
	return {
		id,
		name: `${id}.dng`,
		importedAt: 1,
		kind: 'raw',
		frames: [
			{
				raw: {
					id: assetId,
					storageName: `${assetId}.dng`,
					name: `${id}.dng`,
					contentHash,
					source: {
						kind: 'raw',
						format: 'dng',
						mediaType: 'image/x-adobe-dng',
						size: 3,
						lastModified: 1
					}
				},
				display: null,
				filenameExposureHint: null
			}
		],
		bracketDetection: null,
		thumbnailStorageName: `${id}.jpg`,
		metadata: null,
		width: 1,
		height: 1,
		rating: 0,
		flagged: false,
		rejected: false,
		colorLabel: 'none',
		stackId: null
	};
}

function collection(id: string, name: string, photoId: string): PhotoCollection {
	return { id, name, createdAt: 1, updatedAt: 1, photoIds: [photoId] };
}

function writes(photo: StoredPhoto) {
	const asset = photo.frames[0]!.raw!;
	return {
		originals: [{ storageName: asset.storageName, file: new File(['raw'], asset.name) }],
		thumbnails: [
			{
				storageName: photo.thumbnailStorageName!,
				blob: new Blob(['preview'], { type: 'image/jpeg' })
			}
		]
	};
}

test('deduplicates storage writes and rolls them back when the catalog rejects an import', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	const assets = new MemoryAssetStore();
	const service = new LibraryService(catalog, assets as unknown as AssetStore);
	try {
		const first = storedPhoto('photo-one', 'asset-one', '0'.repeat(64));
		const firstWrites = writes(first);
		await service.importPhotos(
			1,
			[first],
			firstWrites.originals,
			firstWrites.thumbnails,
			collection('collection-one', 'portraits', first.id)
		);

		const duplicate = storedPhoto('photo-two', 'asset-two', '0'.repeat(64));
		const duplicateWrites = writes(duplicate);
		const duplicateResult = await service.importPhotos(
			1,
			[duplicate],
			duplicateWrites.originals,
			duplicateWrites.thumbnails
		);
		assert.equal(duplicateResult.duplicateCount, 1);
		assert.deepEqual(duplicateResult.photoIds, ['photo-one']);
		assert.deepEqual([...assets.originals.keys()], ['asset-one.dng']);

		const conflicting = storedPhoto('photo-three', 'asset-three', '1'.repeat(64));
		const conflictingWrites = writes(conflicting);
		await assert.rejects(
			service.importPhotos(
				1,
				[conflicting],
				conflictingWrites.originals,
				conflictingWrites.thumbnails,
				collection('collection-two', ' PORTRAITS ', conflicting.id)
			)
		);
		assert.deepEqual([...assets.originals.keys()], ['asset-one.dng']);
		assert.equal((await service.loadLibrary())?.photos.length, 1);
	} finally {
		await service.clearAll();
	}
});

test('cleans only unreferenced OPFS files', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	const assets = new MemoryAssetStore();
	const service = new LibraryService(catalog, assets as unknown as AssetStore);
	try {
		const photo = storedPhoto('photo-one', 'asset-one', '0'.repeat(64));
		const photoWrites = writes(photo);
		await service.importPhotos(1, [photo], photoWrites.originals, photoWrites.thumbnails);
		assets.originals.set('orphan.dng', new File(['orphan'], 'orphan.dng'));
		assets.thumbnails.set('orphan.jpg', new Blob(['orphan']));
		assets.edits.set('orphan.json', new Blob(['{}']));

		const result = await service.cleanup();
		assert.equal(result.deletedFiles, 3);
		assert.equal(result.failedFiles, 0);
		assert.equal(result.reclaimedBytes, 14);
		assert.deepEqual([...assets.originals.keys()], ['asset-one.dng']);
		assert.deepEqual([...assets.thumbnails.keys()], ['photo-one.jpg']);
		assert.deepEqual([...assets.edits.keys()], []);
	} finally {
		await service.clearAll();
	}
});

test('resumes file deletion queued by a committed catalog removal', async () => {
	const catalog = new LibraryCatalog(`postframe-test-${crypto.randomUUID()}`);
	const assets = new MemoryAssetStore();
	const service = new LibraryService(catalog, assets as unknown as AssetStore);
	try {
		const photo = storedPhoto('photo-one', 'asset-one', '0'.repeat(64));
		const photoWrites = writes(photo);
		await service.importPhotos(1, [photo], photoWrites.originals, photoWrites.thumbnails);
		await catalog.deletePhoto(photo.id);

		const result = await service.resumePendingDeletions();
		assert.equal(result.deletedFiles, 3);
		assert.equal(result.failedFiles, 0);
		assert.equal((await catalog.pendingDeletions()).length, 0);
		assert.equal(assets.originals.size, 0);
		assert.equal(assets.thumbnails.size, 0);
	} finally {
		await service.clearAll();
	}
});
