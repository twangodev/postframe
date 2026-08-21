import type { AssetUsage, OriginalWrite, ThumbnailWrite } from './asset-store.ts';
import type { LibraryStack, PendingDeleteRecord } from './library-catalog.ts';
import type { EditDocument } from './edit-document.ts';
import type { FileSource } from './worker.ts';
import type { LibraryManifest, PhotoCollection, StoredPhoto } from './library-schema.ts';
import type { Preset } from './preset.ts';
import type { CameraMatchPreference } from './camera-match.ts';

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

export interface PhotoAssetStore {
	readOriginal(storageName: string): Promise<Blob>;
	originalSource(storageName: string): Promise<FileSource>;
	readThumbnail(storageName: string): Promise<Blob>;
}

export interface RenderCacheStore {
	renderCacheHandle(photoId: string): Promise<FileSystemFileHandle>;
}

export interface EditDocumentStore {
	saveMaskRaster(photoId: string, componentId: string, alpha: Uint8Array): Promise<string>;
	readMaskRaster(storageName: string): Promise<ArrayBuffer>;
	deleteMaskRasters(storageNames: readonly string[]): Promise<void>;
	loadEditDocument(photoId: string): Promise<EditDocument>;
	saveEditDocument(photoId: string, value: EditDocument): Promise<void>;
}

export interface LibraryCatalogStore {
	loadLibrary(): Promise<LibraryManifest | null>;
	saveLibrary(
		value: LibraryManifest,
		originals?: readonly OriginalWrite[],
		thumbnails?: readonly ThumbnailWrite[]
	): Promise<void>;
	importPhotos(
		libraryCreatedAt: number,
		photos: readonly StoredPhoto[],
		originals: readonly OriginalWrite[],
		thumbnails: readonly ThumbnailWrite[],
		collection?: PhotoCollection | null
	): Promise<ImportResult>;
	updatePhotoState(photo: StoredPhoto): Promise<void>;
	saveCollection(collection: PhotoCollection): Promise<void>;
	deleteCollection(collectionId: string): Promise<void>;
	saveStacks(
		stacks: readonly LibraryStack[],
		changedPhotos: ReadonlyMap<string, string | null>
	): Promise<void>;
	listPresets(): Promise<Preset[]>;
	savePreset(preset: Preset): Promise<void>;
	deletePreset(presetId: string): Promise<void>;
	saveCameraMatchPreference(preference: CameraMatchPreference): Promise<void>;
}

export interface StorageMaintenance {
	deletePhoto(photoId: string): Promise<CleanupResult>;
	cleanup(): Promise<CleanupResult>;
	storageUsage(): Promise<AssetUsage>;
	resumePendingDeletions(): Promise<CleanupResult>;
}

export interface LocalLibraryReset {
	clearAll(): Promise<void>;
}

export interface LibraryBackend
	extends
		PhotoAssetStore,
		RenderCacheStore,
		EditDocumentStore,
		LibraryCatalogStore,
		StorageMaintenance {
	close(): void;
}

export type LibraryPersistence = LibraryCatalogStore &
	EditDocumentStore &
	Pick<StorageMaintenance, 'deletePhoto'>;

export type { PendingDeleteRecord };
