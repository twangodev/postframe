import { AssetStore, type OriginalWrite, type ThumbnailWrite } from './asset-store';
import { LibraryCatalog } from './library-catalog';
import { libraryManifestSchema, type LibraryManifest } from './library-schema';

export type { OriginalWrite, ThumbnailWrite } from './asset-store';

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
		validateWrites(library, originals, thumbnails);
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
	library: LibraryManifest,
	originals: readonly OriginalWrite[],
	thumbnails: readonly ThumbnailWrite[]
) {
	const originalNames = new Set(
		library.photos.flatMap((photo) =>
			photo.frames.flatMap((frame) =>
				[frame.raw?.storageName, frame.display?.storageName].filter(
					(storageName): storageName is string => storageName !== undefined
				)
			)
		)
	);
	const thumbnailNames = new Set(
		library.photos.flatMap((photo) =>
			photo.thumbnailStorageName ? [photo.thumbnailStorageName] : []
		)
	);

	for (const original of originals) {
		if (!originalNames.has(original.storageName)) {
			throw new Error(`Original ${original.storageName} is not part of the library`);
		}
	}
	for (const thumbnail of thumbnails) {
		if (!thumbnailNames.has(thumbnail.storageName)) {
			throw new Error(`Thumbnail ${thumbnail.storageName} is not part of the library`);
		}
	}
}
