import { invoke } from '@tauri-apps/api/core';
import type { LibraryStack } from '../library-catalog.ts';
import {
	libraryManifestSchema,
	photoCollectionSchema,
	storedPhotoSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredPhoto
} from '../library-schema.ts';
import { presetSchema, type Preset } from '../preset.ts';

export interface PendingDelete {
	kind: 'original' | 'thumbnail' | 'edit' | 'derived';
	storageName: string;
	queuedAt: number;
}

export interface StorageReferences {
	originals: string[];
	thumbnails: string[];
	edits: string[];
	masks: string[];
	photoIds: string[];
}

interface ImportResolution {
	additions: StoredPhoto[];
	photoIds: Record<string, string>;
}

export function createDesktopCatalog() {
	return {
		async loadLibrary() {
			const library = await invoke<LibraryManifest | null>('catalog_load_library');
			return library ? libraryManifestSchema.parse(library) : null;
		},

		async resolveImports(photos: readonly StoredPhoto[]) {
			const resolution = await invoke<ImportResolution>('catalog_resolve_imports', { photos });
			return {
				additions: resolution.additions.map((photo) => storedPhotoSchema.parse(photo)),
				photoIds: resolution.photoIds
			};
		},

		saveLibrary(library: LibraryManifest) {
			return invoke<void>('catalog_save_library', { library: nativeManifest(library) });
		},

		addPhotos(
			libraryCreatedAt: number,
			photos: readonly StoredPhoto[],
			collection: PhotoCollection | null
		) {
			return invoke<void>('catalog_add_photos', {
				libraryCreatedAt,
				photos,
				collection: collection ? nativeCollection(collection) : null
			});
		},

		updatePhotoState(photo: StoredPhoto) {
			return invoke<void>('catalog_update_photo', { photo: storedPhotoSchema.parse(photo) });
		},

		saveCollection(collection: PhotoCollection) {
			return invoke<void>('catalog_save_collection', {
				collection: nativeCollection(photoCollectionSchema.parse(collection))
			});
		},

		deleteCollection(collectionId: string) {
			return invoke<void>('catalog_delete_collection', { collectionId });
		},

		saveStacks(stacks: readonly LibraryStack[], changedPhotos: ReadonlyMap<string, string | null>) {
			return invoke<void>('catalog_save_stacks', {
				stacks,
				changedPhotos: Object.fromEntries(changedPhotos)
			});
		},

		async listPresets() {
			return (await invoke<Preset[]>('catalog_list_presets')).map((preset) =>
				presetSchema.parse(preset)
			);
		},

		savePreset(preset: Preset) {
			return invoke<void>('catalog_save_preset', { preset: presetSchema.parse(preset) });
		},

		deletePreset(presetId: string) {
			return invoke<void>('catalog_delete_preset', { presetId });
		},

		deletePhoto(photoId: string, renderCacheName: string) {
			return invoke<PendingDelete[]>('catalog_delete_photo', { photoId, renderCacheName });
		},

		pendingDeletions() {
			return invoke<PendingDelete[]>('catalog_pending_deletions');
		},

		completeDeletions(deletions: readonly PendingDelete[]) {
			return invoke<void>('catalog_complete_deletions', { deletions });
		},

		storageReferences() {
			return invoke<StorageReferences>('catalog_storage_references');
		},

		close() {
			void invoke('close_library');
		}
	};
}

export type DesktopCatalog = ReturnType<typeof createDesktopCatalog>;

function nativeManifest(library: LibraryManifest) {
	return {
		...library,
		collections: library.collections.map(nativeCollection)
	};
}

function nativeCollection(collection: PhotoCollection) {
	return {
		...collection,
		normalizedName: collection.name.normalize('NFKC').trim().toLocaleLowerCase()
	};
}
