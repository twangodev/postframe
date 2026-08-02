import {
	AssetStore,
	type EditWrite,
	type OriginalWrite,
	type StoredFile,
	type ThumbnailWrite
} from './asset-store.ts';
import { LibraryCatalog, type LibraryStack, type PendingDeleteRecord } from './library-catalog.ts';
import {
	libraryManifestSchema,
	photoCollectionSchema,
	storedPhotoSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredPhoto
} from './library-schema.ts';
import {
	defaultDevelopSettings,
	developSettingsSchema,
	developStorageName,
	type DevelopSettings
} from './develop-settings.ts';

export type { EditWrite, OriginalWrite, ThumbnailWrite } from './asset-store.ts';

export interface ImportResult {
	photos: StoredPhoto[];
	photoIds: string[];
	collection: PhotoCollection | null;
	duplicateCount: number;
}

export interface CleanupResult {
	deletedFiles: number;
	failedFiles: number;
	reclaimedBytes: number;
}

export class LibraryService {
	readonly catalog: LibraryCatalog;
	readonly assets: AssetStore;

	constructor(catalog = new LibraryCatalog(), assets = new AssetStore()) {
		this.catalog = catalog;
		this.assets = assets;
	}

	static supported() {
		return typeof indexedDB !== 'undefined' && AssetStore.supported();
	}

	loadLibrary() {
		return this.catalog.loadLibrary();
	}

	readOriginal(storageName: string) {
		return this.assets.readOriginal(storageName);
	}

	originalHandle(storageName: string) {
		return this.assets.originalHandle(storageName);
	}

	readThumbnail(storageName: string) {
		return this.assets.readThumbnail(storageName);
	}

	async loadDevelopSettings(photoId: string) {
		const file = await this.assets.readEdit(developStorageName(photoId));
		if (!file) return defaultDevelopSettings();
		return developSettingsSchema.parse(JSON.parse(await file.text()));
	}

	async saveDevelopSettings(photoId: string, value: DevelopSettings) {
		const settings = developSettingsSchema.parse(value);
		const write: EditWrite = {
			storageName: developStorageName(photoId),
			blob: new Blob([JSON.stringify(settings)], { type: 'application/json' })
		};
		await this.assets.writeEdits([write]);
	}

	async saveLibrary(
		value: LibraryManifest,
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) {
		const library = libraryManifestSchema.parse(value);
		validateWrites(library.photos, originals, thumbnails);
		let createdOriginals: string[] = [];
		let createdThumbnails: string[] = [];

		try {
			createdOriginals = await this.assets.writeOriginals(originals);
			createdThumbnails = await this.assets.writeThumbnails(thumbnails);
			await this.catalog.saveLibrary(library);
		} catch (error) {
			await Promise.allSettled([
				this.assets.deleteOriginals(createdOriginals),
				this.assets.deleteThumbnails(createdThumbnails)
			]);
			throw error;
		}
	}

	async importPhotos(
		libraryCreatedAt: number,
		photos: readonly StoredPhoto[],
		originals: readonly OriginalWrite[],
		thumbnails: readonly ThumbnailWrite[],
		collection: PhotoCollection | null = null
	): Promise<ImportResult> {
		const candidates = photos.map((photo) => storedPhotoSchema.parse(photo));
		const parsedCollection = collection ? photoCollectionSchema.parse(collection) : null;
		const resolution = await this.catalog.resolveImports(candidates);
		const resolvedCollection = parsedCollection
			? {
					...parsedCollection,
					photoIds: [
						...new Set(
							parsedCollection.photoIds.map(
								(photoId) => resolution.photoIds.get(photoId) ?? photoId
							)
						)
					]
				}
			: null;
		const originalNames = assetStorageNames(resolution.additions);
		const thumbnailNames = thumbnailStorageNames(resolution.additions);
		const originalWrites = originals.filter(({ storageName }) => originalNames.has(storageName));
		const thumbnailWrites = thumbnails.filter(({ storageName }) => thumbnailNames.has(storageName));
		validateWrites(resolution.additions, originalWrites, thumbnailWrites, true);

		let createdOriginals: string[] = [];
		let createdThumbnails: string[] = [];
		try {
			createdOriginals = await this.assets.writeOriginals(originalWrites);
			createdThumbnails = await this.assets.writeThumbnails(thumbnailWrites);
			await this.catalog.addPhotos(libraryCreatedAt, resolution.additions, resolvedCollection);
		} catch (error) {
			await Promise.allSettled([
				this.assets.deleteOriginals(createdOriginals),
				this.assets.deleteThumbnails(createdThumbnails)
			]);
			throw error;
		}

		return {
			photos: resolution.additions,
			photoIds: candidates.map((photo) => resolution.photoIds.get(photo.id) ?? photo.id),
			collection: resolvedCollection,
			duplicateCount: candidates.length - resolution.additions.length
		};
	}

	updatePhotoState(photo: StoredPhoto) {
		return this.catalog.updatePhotoState(storedPhotoSchema.parse(photo));
	}

	saveCollection(collection: PhotoCollection) {
		return this.catalog.saveCollection(photoCollectionSchema.parse(collection));
	}

	deleteCollection(collectionId: string) {
		return this.catalog.deleteCollection(collectionId);
	}

	saveStacks(stacks: readonly LibraryStack[], changedPhotos: ReadonlyMap<string, string | null>) {
		return this.catalog.saveStacks(stacks, changedPhotos);
	}

	async deletePhoto(photoId: string): Promise<CleanupResult> {
		const deletions = await this.catalog.deletePhoto(photoId);
		return this.flushDeletions(deletions, new Map());
	}

	async cleanup(): Promise<CleanupResult> {
		const [references, originals, thumbnails, edits, pending] = await Promise.all([
			this.catalog.storageReferences(),
			this.assets.listOriginals(),
			this.assets.listThumbnails(),
			this.assets.listEdits(),
			this.catalog.pendingDeletions()
		]);
		const files = new Map<string, StoredFile>();
		for (const file of originals) files.set(deletionKey('original', file.storageName), file);
		for (const file of thumbnails) files.set(deletionKey('thumbnail', file.storageName), file);
		for (const file of edits) files.set(deletionKey('edit', file.storageName), file);
		const deletions = new Map<string, PendingDeleteRecord>();
		for (const deletion of pending)
			deletions.set(deletionKey(deletion.kind, deletion.storageName), deletion);
		for (const file of originals) {
			if (!references.originals.has(file.storageName)) {
				const deletion = pendingDeletion('original', file.storageName);
				deletions.set(deletionKey(deletion.kind, deletion.storageName), deletion);
			}
		}
		for (const file of thumbnails) {
			if (!references.thumbnails.has(file.storageName)) {
				const deletion = pendingDeletion('thumbnail', file.storageName);
				deletions.set(deletionKey(deletion.kind, deletion.storageName), deletion);
			}
		}
		for (const file of edits) {
			if (!references.edits.has(file.storageName)) {
				const deletion = pendingDeletion('edit', file.storageName);
				deletions.set(deletionKey(deletion.kind, deletion.storageName), deletion);
			}
		}
		return this.flushDeletions([...deletions.values()], files);
	}

	async resumePendingDeletions(): Promise<CleanupResult> {
		const [deletions, originals, thumbnails, edits] = await Promise.all([
			this.catalog.pendingDeletions(),
			this.assets.listOriginals(),
			this.assets.listThumbnails(),
			this.assets.listEdits()
		]);
		const files = new Map<string, StoredFile>();
		for (const file of originals) files.set(deletionKey('original', file.storageName), file);
		for (const file of thumbnails) files.set(deletionKey('thumbnail', file.storageName), file);
		for (const file of edits) files.set(deletionKey('edit', file.storageName), file);
		return this.flushDeletions(deletions, files);
	}

	async clearAll() {
		const results = await Promise.allSettled([this.catalog.clear(), this.assets.clearAll()]);
		const errors = results.flatMap((result) =>
			result.status === 'rejected' ? [result.reason] : []
		);
		if (errors.length > 0) throw new AggregateError(errors, 'Unable to clear the local library');
	}

	close() {
		this.catalog.close();
	}

	private async flushDeletions(
		deletions: readonly PendingDeleteRecord[],
		files: ReadonlyMap<string, StoredFile>
	): Promise<CleanupResult> {
		const completed: PendingDeleteRecord[] = [];
		let reclaimedBytes = 0;

		await Promise.all(
			deletions.map(async (deletion) => {
				try {
					if (deletion.kind === 'original')
						await this.assets.deleteOriginals([deletion.storageName]);
					else if (deletion.kind === 'thumbnail')
						await this.assets.deleteThumbnails([deletion.storageName]);
					else await this.assets.deleteEdits([deletion.storageName]);
					completed.push(deletion);
					reclaimedBytes += files.get(deletionKey(deletion.kind, deletion.storageName))?.size ?? 0;
				} catch {
					return;
				}
			})
		);
		await this.catalog.completeDeletions(completed);
		return {
			deletedFiles: completed.length,
			failedFiles: deletions.length - completed.length,
			reclaimedBytes
		};
	}
}

function pendingDeletion(
	kind: PendingDeleteRecord['kind'],
	storageName: string
): PendingDeleteRecord {
	return { kind, storageName, queuedAt: Date.now() };
}

function deletionKey(kind: PendingDeleteRecord['kind'], storageName: string) {
	return `${kind}:${storageName}`;
}

function validateWrites(
	photos: readonly StoredPhoto[],
	originals: readonly OriginalWrite[],
	thumbnails: readonly ThumbnailWrite[],
	requireAll = false
) {
	const originalNames = assetStorageNames(photos);
	const thumbnailNames = thumbnailStorageNames(photos);
	const originalWriteNames = new Set(originals.map(({ storageName }) => storageName));
	const thumbnailWriteNames = new Set(thumbnails.map(({ storageName }) => storageName));

	assertMatchingWrites('original', originalNames, originalWriteNames, requireAll);
	assertMatchingWrites('thumbnail', thumbnailNames, thumbnailWriteNames, requireAll);
}

function assetStorageNames(photos: readonly StoredPhoto[]) {
	return new Set(
		photos.flatMap((photo) =>
			photo.frames.flatMap((frame) =>
				[frame.raw?.storageName, frame.display?.storageName].filter(
					(storageName): storageName is string => storageName !== undefined
				)
			)
		)
	);
}

function thumbnailStorageNames(photos: readonly StoredPhoto[]) {
	return new Set(
		photos.flatMap((photo) => (photo.thumbnailStorageName ? [photo.thumbnailStorageName] : []))
	);
}

function assertMatchingWrites(
	kind: string,
	expected: ReadonlySet<string>,
	actual: ReadonlySet<string>,
	requireAll: boolean
) {
	if (requireAll) {
		for (const storageName of expected) {
			if (!actual.has(storageName)) throw new Error(`Missing ${kind} ${storageName}`);
		}
	}
	for (const storageName of actual) {
		if (!expected.has(storageName)) throw new Error(`Unexpected ${kind} ${storageName}`);
	}
}
