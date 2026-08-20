import type { AssetUsage, OriginalWrite, ThumbnailWrite } from './asset-store.ts';
import type { CleanupResult, ImportResult } from './library-service.ts';
import type { LibraryStack, PendingDeleteRecord } from './library-catalog.ts';
import type { EditDocument } from './edit-document.ts';
import type { FileSource } from './worker.ts';
import type { LibraryManifest, PhotoCollection, StoredPhoto } from './library-schema.ts';
import type { Preset } from './preset.ts';

export interface LibraryBackend {
	loadLibrary(): Promise<LibraryManifest | null>;
	readOriginal(storageName: string): Promise<Blob>;
	originalSource(storageName: string): Promise<FileSource>;
	renderCacheHandle(photoId: string): Promise<FileSystemFileHandle>;
	saveMaskRaster(photoId: string, componentId: string, alpha: Uint8Array): Promise<string>;
	readMaskRaster(storageName: string): Promise<ArrayBuffer>;
	deleteMaskRasters(storageNames: readonly string[]): Promise<void>;
	readThumbnail(storageName: string): Promise<Blob>;
	loadEditDocument(photoId: string): Promise<EditDocument>;
	saveEditDocument(photoId: string, value: EditDocument): Promise<void>;
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
	deletePhoto(photoId: string): Promise<CleanupResult>;
	cleanup(): Promise<CleanupResult>;
	storageUsage(): Promise<AssetUsage>;
	resumePendingDeletions(): Promise<CleanupResult>;
	clearAll(): Promise<void>;
	close(): void;
}

export type { PendingDeleteRecord };
