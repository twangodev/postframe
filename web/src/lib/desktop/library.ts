import { AssetStore, type OriginalWrite, type ThumbnailWrite } from '../asset-store.ts';
import type { LibraryBackend } from '../library-backend.ts';
import {
	libraryManifestSchema,
	photoCollectionSchema,
	storedPhotoSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredPhoto
} from '../library-schema.ts';
import { createDesktopAssets } from './assets.ts';
import { createDesktopCatalog } from './catalog.ts';
import { createDesktopMaintenance } from './maintenance.ts';

export function createDesktopLibraryBackend(cache: AssetStore): LibraryBackend {
	const assets = createDesktopAssets(cache);
	const catalog = createDesktopCatalog();
	const maintenance = createDesktopMaintenance(catalog, assets);

	const saveLibrary = async (
		value: LibraryManifest,
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) => {
		const library = libraryManifestSchema.parse(value);
		await assets.writeOriginals(originals, library.photos);
		await assets.writeThumbnails(thumbnails);
		try {
			await catalog.saveLibrary(library);
		} catch (error) {
			await rollbackWrites(assets, originals, thumbnails);
			throw error;
		}
	};

	const importPhotos = async (
		libraryCreatedAt: number,
		photos: readonly StoredPhoto[],
		originals: readonly OriginalWrite[],
		thumbnails: readonly ThumbnailWrite[],
		collection: PhotoCollection | null = null
	) => {
		const candidates = photos.map((photo) => storedPhotoSchema.parse(photo));
		const resolution = await catalog.resolveImports(candidates);
		const resolvedCollection = collection
			? photoCollectionSchema.parse({
					...collection,
					photoIds: [...new Set(collection.photoIds.map((id) => resolution.photoIds[id] ?? id))]
				})
			: null;
		const originalNames = assetStorageNames(resolution.additions);
		const thumbnailNames = thumbnailStorageNames(resolution.additions);
		const originalWrites = originals.filter(({ storageName }) => originalNames.has(storageName));
		const thumbnailWrites = thumbnails.filter(({ storageName }) => thumbnailNames.has(storageName));
		await assets.writeOriginals(originalWrites, resolution.additions);
		await assets.writeThumbnails(thumbnailWrites);
		try {
			await catalog.addPhotos(libraryCreatedAt, resolution.additions, resolvedCollection);
		} catch (error) {
			await rollbackWrites(assets, originalWrites, thumbnailWrites);
			throw error;
		}
		return {
			photos: resolution.additions,
			photoIds: candidates.map(({ id }) => resolution.photoIds[id] ?? id),
			collection: resolvedCollection,
			duplicateCount: candidates.length - resolution.additions.length
		};
	};

	return {
		loadLibrary: catalog.loadLibrary,
		readOriginal: assets.readOriginal,
		originalSource: assets.originalSource,
		renderCacheHandle: assets.renderCacheHandle,
		saveMaskRaster: assets.saveMaskRaster,
		readMaskRaster: assets.readMaskRaster,
		deleteMaskRasters: assets.deleteMaskRasters,
		readThumbnail: assets.readThumbnail,
		loadEditDocument: assets.loadEditDocument,
		saveEditDocument: assets.saveEditDocument,
		saveLibrary,
		importPhotos,
		updatePhotoState: catalog.updatePhotoState,
		saveCollection: catalog.saveCollection,
		deleteCollection: catalog.deleteCollection,
		saveStacks: catalog.saveStacks,
		listPresets: catalog.listPresets,
		savePreset: catalog.savePreset,
		deletePreset: catalog.deletePreset,
		saveCameraMatchPreference: catalog.saveCameraMatchPreference,
		deletePhoto: maintenance.deletePhoto,
		cleanup: maintenance.cleanup,
		storageUsage: maintenance.storageUsage,
		resumePendingDeletions: maintenance.resumePendingDeletions,
		close: catalog.close
	};
}

async function rollbackWrites(
	assets: ReturnType<typeof createDesktopAssets>,
	originals: readonly OriginalWrite[],
	thumbnails: readonly ThumbnailWrite[]
) {
	await Promise.allSettled([
		assets.deleteAssets(
			'originals',
			originals.map(({ storageName }) => storageName)
		),
		assets.deleteAssets(
			'thumbnails',
			thumbnails.map(({ storageName }) => storageName)
		)
	]);
}

function assetStorageNames(photos: readonly StoredPhoto[]) {
	return new Set(
		photos.flatMap((photo) =>
			photo.frames.flatMap((frame) =>
				[frame.raw?.storageName, frame.display?.storageName].filter(
					(name): name is string => name !== undefined
				)
			)
		)
	);
}

function thumbnailStorageNames(photos: readonly StoredPhoto[]) {
	return new Set(photos.flatMap((photo) => photo.thumbnailStorageName ?? []));
}
