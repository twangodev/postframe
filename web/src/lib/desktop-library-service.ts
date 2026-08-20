import { invoke } from '@tauri-apps/api/core';
import {
	AssetStore,
	type AssetUsage,
	type OriginalWrite,
	type StoredFile,
	type ThumbnailWrite
} from './asset-store.ts';
import {
	createDesktopLibrary,
	desktopAssetExists,
	desktopAssetSource,
	desktopStatus,
	openDesktopLibrary,
	revealDesktopLibrary,
	writeDesktopAsset,
	type DesktopStatus
} from './desktop-api.ts';
import {
	defaultEditDocument,
	editDocumentSchema,
	editDocumentStorageName,
	parseEditDocument,
	type EditDocument
} from './edit-document.ts';
import type { LibraryBackend } from './library-backend.ts';
import type { LibraryStack } from './library-catalog.ts';
import {
	libraryManifestSchema,
	photoCollectionSchema,
	storedPhotoSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredPhoto
} from './library-schema.ts';
import type { CleanupResult, ImportResult } from './library-service.ts';
import { presetSchema, type Preset } from './preset.ts';
import { renderCacheStorageName } from './render-cache.ts';

interface NativeImportResolution {
	additions: StoredPhoto[];
	photoIds: Record<string, string>;
}

interface PendingDelete {
	kind: 'original' | 'thumbnail' | 'edit' | 'derived';
	storageName: string;
	queuedAt: number;
}

interface StorageReferences {
	originals: string[];
	thumbnails: string[];
	edits: string[];
	masks: string[];
	photoIds: string[];
}

interface DurableUsage {
	originals: number;
	thumbnails: number;
	edits: number;
	masks: number;
}

const EMPTY_CLEANUP: CleanupResult = { deletedFiles: 0, failedFiles: 0, reclaimedBytes: 0 };

export class DesktopLibraryService implements LibraryBackend {
	private readonly cache = new AssetStore();

	status(): Promise<DesktopStatus> {
		return desktopStatus();
	}

	create() {
		return createDesktopLibrary();
	}

	open() {
		return openDesktopLibrary();
	}

	reveal() {
		return revealDesktopLibrary();
	}

	clearCaches() {
		return this.cache.clearCaches();
	}

	async loadLibrary() {
		const library = await invoke<LibraryManifest | null>('catalog_load_library');
		return library ? libraryManifestSchema.parse(library) : null;
	}

	async readOriginal(storageName: string) {
		return this.readAsset('originals', storageName);
	}

	async originalSource(storageName: string) {
		const source = await desktopAssetSource('originals', storageName);
		return { kind: 'url' as const, ...source };
	}

	renderCacheHandle(photoId: string) {
		return this.cache.derivedHandle(renderCacheStorageName(photoId));
	}

	async saveMaskRaster(photoId: string, componentId: string, alpha: Uint8Array) {
		const storageName = `${photoId}-${componentId}.mask`;
		await writeDesktopAsset('masks', storageName, alpha);
		return storageName;
	}

	async readMaskRaster(storageName: string) {
		return this.readAsset('masks', storageName).then((blob) => blob.arrayBuffer());
	}

	deleteMaskRasters(storageNames: readonly string[]) {
		return this.deleteNativeAssets('masks', storageNames);
	}

	readThumbnail(storageName: string) {
		return this.readAsset('thumbnails', storageName);
	}

	async loadEditDocument(photoId: string) {
		const storageName = editDocumentStorageName(photoId);
		if (!(await desktopAssetExists('edits', storageName))) return defaultEditDocument(photoId);
		const file = await this.readAsset('edits', storageName);
		return parseEditDocument(JSON.parse(await file.text()), photoId);
	}

	async saveEditDocument(photoId: string, value: EditDocument) {
		const document = editDocumentSchema.parse(value);
		if (document.photoId !== photoId) throw new Error('Edit document belongs to another photo');
		await writeDesktopAsset(
			'edits',
			editDocumentStorageName(photoId),
			new Blob([JSON.stringify(document)], { type: 'application/json' })
		);
	}

	async saveLibrary(
		value: LibraryManifest,
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) {
		const library = libraryManifestSchema.parse(value);
		await this.writeOriginals(originals, library.photos);
		await this.writeThumbnails(thumbnails);
		try {
			await invoke('catalog_save_library', { library: nativeManifest(library) });
		} catch (error) {
			await this.rollbackWrites(originals, thumbnails);
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
		const resolution = await invoke<NativeImportResolution>('catalog_resolve_imports', {
			photos: candidates
		});
		const additions = resolution.additions.map((photo) => storedPhotoSchema.parse(photo));
		const resolvedCollection = collection
			? photoCollectionSchema.parse({
					...collection,
					photoIds: [...new Set(collection.photoIds.map((id) => resolution.photoIds[id] ?? id))]
				})
			: null;
		const originalNames = assetStorageNames(additions);
		const thumbnailNames = thumbnailStorageNames(additions);
		const originalWrites = originals.filter(({ storageName }) => originalNames.has(storageName));
		const thumbnailWrites = thumbnails.filter(({ storageName }) => thumbnailNames.has(storageName));
		await this.writeOriginals(originalWrites, additions);
		await this.writeThumbnails(thumbnailWrites);
		try {
			await invoke('catalog_add_photos', {
				libraryCreatedAt,
				photos: additions,
				collection: resolvedCollection ? nativeCollection(resolvedCollection) : null
			});
		} catch (error) {
			await this.rollbackWrites(originalWrites, thumbnailWrites);
			throw error;
		}
		return {
			photos: additions,
			photoIds: candidates.map(({ id }) => resolution.photoIds[id] ?? id),
			collection: resolvedCollection,
			duplicateCount: candidates.length - additions.length
		};
	}

	async updatePhotoState(photo: StoredPhoto) {
		await invoke('catalog_update_photo', { photo: storedPhotoSchema.parse(photo) });
	}

	async saveCollection(collection: PhotoCollection) {
		const parsed = photoCollectionSchema.parse(collection);
		await invoke('catalog_save_collection', {
			collection: nativeCollection(parsed)
		});
	}

	async deleteCollection(collectionId: string) {
		await invoke('catalog_delete_collection', { collectionId });
	}

	async saveStacks(
		stacks: readonly LibraryStack[],
		changedPhotos: ReadonlyMap<string, string | null>
	) {
		await invoke('catalog_save_stacks', {
			stacks,
			changedPhotos: Object.fromEntries(changedPhotos)
		});
	}

	async listPresets() {
		return (await invoke<Preset[]>('catalog_list_presets')).map((preset) =>
			presetSchema.parse(preset)
		);
	}

	async savePreset(preset: Preset) {
		await invoke('catalog_save_preset', { preset: presetSchema.parse(preset) });
	}

	async deletePreset(presetId: string) {
		await invoke('catalog_delete_preset', { presetId });
	}

	async deletePhoto(photoId: string) {
		const document = await this.loadEditDocument(photoId).catch(() => null);
		const pending = await invoke<PendingDelete[]>('catalog_delete_photo', {
			photoId,
			renderCacheName: renderCacheStorageName(photoId)
		});
		const [library, masks] = await Promise.all([
			this.flushPending(pending),
			this.deleteFiles('masks', maskStorageNames(document))
		]);
		return mergeCleanup(library, masks);
	}

	async cleanup() {
		const pending = await this.resumePendingDeletions();
		const references = await invoke<StorageReferences>('catalog_storage_references');
		const native = await Promise.all([
			this.deleteOrphans('originals', references.originals),
			this.deleteOrphans('thumbnails', references.thumbnails),
			this.deleteOrphans('edits', references.edits),
			this.deleteOrphans('masks', references.masks)
		]);
		const derived = await this.cache.listDerived();
		const expectedDerived = new Set(references.photoIds.map(renderCacheStorageName));
		const staleDerived = derived.filter(({ storageName }) => !expectedDerived.has(storageName));
		await this.cache.deleteDerived(staleDerived.map(({ storageName }) => storageName));
		return mergeCleanup(pending, ...native, cleanupResult(staleDerived, staleDerived.length, 0));
	}

	async storageUsage(): Promise<AssetUsage> {
		const [durable, cache] = await Promise.all([
			invoke<DurableUsage>('durable_usage'),
			this.cache.usage()
		]);
		return {
			originals: durable.originals,
			thumbnails: durable.thumbnails,
			edits: durable.edits,
			derived: cache.derived,
			models: cache.models,
			masks: durable.masks
		};
	}

	async resumePendingDeletions() {
		return this.flushPending(await invoke<PendingDelete[]>('catalog_pending_deletions'));
	}

	async clearAll() {
		throw new Error('Desktop libraries can only be removed from the system file manager');
	}

	close() {
		void invoke('close_library');
	}

	private async readAsset(kind: string, storageName: string) {
		const source = await desktopAssetSource(kind, storageName);
		const response = await fetch(source.url);
		if (!response.ok) throw new Error(`Unable to read ${source.name}`);
		return response.blob();
	}

	private async writeOriginals(writes: readonly OriginalWrite[], photos: readonly StoredPhoto[]) {
		const hashes = new Map(
			photos.flatMap((photo) =>
				photo.frames.flatMap((frame) =>
					[frame.raw, frame.display]
						.filter((asset): asset is NonNullable<typeof asset> => asset !== null)
						.map((asset) => [asset.storageName, asset.contentHash] as const)
				)
			)
		);
		for (const write of writes) {
			await writeDesktopAsset(
				'originals',
				write.storageName,
				write.file,
				hashes.get(write.storageName) ?? null
			);
		}
	}

	private async writeThumbnails(writes: readonly ThumbnailWrite[]) {
		for (const write of writes) {
			await writeDesktopAsset('thumbnails', write.storageName, write.blob);
		}
	}

	private rollbackWrites(
		originals: readonly OriginalWrite[],
		thumbnails: readonly ThumbnailWrite[]
	) {
		return Promise.allSettled([
			this.deleteNativeAssets(
				'originals',
				originals.map(({ storageName }) => storageName)
			),
			this.deleteNativeAssets(
				'thumbnails',
				thumbnails.map(({ storageName }) => storageName)
			)
		]);
	}

	private async flushPending(deletions: PendingDelete[]): Promise<CleanupResult> {
		const completed: PendingDelete[] = [];
		for (const deletion of deletions) {
			try {
				if (deletion.kind === 'derived') {
					await this.cache.deleteDerived([deletion.storageName]);
				} else {
					await this.deleteNativeAssets(`${deletion.kind}s`, [deletion.storageName]);
				}
				completed.push(deletion);
			} catch {}
		}
		await invoke('catalog_complete_deletions', { deletions: completed });
		return {
			deletedFiles: completed.length,
			failedFiles: deletions.length - completed.length,
			reclaimedBytes: 0
		};
	}

	private async deleteOrphans(kind: string, references: readonly string[]) {
		const files = await invoke<StoredFile[]>('list_assets', { kind });
		const referenced = new Set(references);
		const orphans = files.filter(({ storageName }) => !referenced.has(storageName));
		return this.deleteFiles(kind, orphans);
	}

	private async deleteFiles(
		kind: string,
		files: readonly (StoredFile | string)[]
	): Promise<CleanupResult> {
		if (files.length === 0) return { ...EMPTY_CLEANUP };
		try {
			await this.deleteNativeAssets(
				kind,
				files.map((file) => (typeof file === 'string' ? file : file.storageName))
			);
			return cleanupResult(files, files.length, 0);
		} catch {
			return cleanupResult([], 0, files.length);
		}
	}

	private async deleteNativeAssets(kind: string, storageNames: readonly string[]) {
		if (storageNames.length === 0) return;
		await invoke('delete_assets', { kind, storageNames });
	}
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

function thumbnailStorageNames(photos: readonly StoredPhoto[]) {
	return new Set(photos.flatMap((photo) => photo.thumbnailStorageName ?? []));
}

function maskStorageNames(document: EditDocument | null) {
	return (
		document?.masks.flatMap((mask) =>
			mask.components.flatMap((component) => component.raster?.storageName ?? [])
		) ?? []
	);
}

function cleanupResult(
	files: readonly (StoredFile | string)[],
	deletedFiles: number,
	failedFiles: number
): CleanupResult {
	return {
		deletedFiles,
		failedFiles,
		reclaimedBytes: files.reduce(
			(total, file) => total + (typeof file === 'string' ? 0 : file.size),
			0
		)
	};
}

function mergeCleanup(...results: CleanupResult[]): CleanupResult {
	return results.reduce(
		(total, result) => ({
			deletedFiles: total.deletedFiles + result.deletedFiles,
			failedFiles: total.failedFiles + result.failedFiles,
			reclaimedBytes: total.reclaimedBytes + result.reclaimedBytes
		}),
		{ ...EMPTY_CLEANUP }
	);
}

export type { DesktopStatus };
