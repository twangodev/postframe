import { AssetStore, type OriginalWrite, type ThumbnailWrite } from './asset-store';
import { LibraryCatalog } from './library-catalog';
import {
	libraryManifestSchema,
	photoCollectionSchema,
	storedPhotoSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredPhoto
} from './library-schema';

export type { OriginalWrite, ThumbnailWrite } from './asset-store';

export interface ImportResult {
	photos: StoredPhoto[];
	photoIds: string[];
	collection: PhotoCollection | null;
	duplicateCount: number;
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
