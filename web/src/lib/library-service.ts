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
	defaultEditDocument,
	editDocumentStorageName,
	editDocumentSchema,
	parseEditDocument,
	type EditDocument
} from './edit-document.ts';
import { presetSchema, type Preset } from './preset.ts';
import { renderCacheStorageName } from './render-cache.ts';

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
	private staleRenderCacheReclaim: Promise<CleanupResult> | null = null;

	constructor(catalog = new LibraryCatalog(), assets = new AssetStore()) {
		this.catalog = catalog;
		this.assets = assets;
	}

	static supported() {
		return typeof indexedDB !== 'undefined' && AssetStore.supported();
	}

	async loadLibrary() {
		const library = await this.catalog.loadLibrary();
		this.reclaimStaleRenderCaches().catch(() => undefined);
		return library;
	}

	reclaimStaleRenderCaches(): Promise<CleanupResult> {
		return (this.staleRenderCacheReclaim ??= this.deleteStaleRenderCaches());
	}

	readOriginal(storageName: string) {
		return this.assets.readOriginal(storageName);
	}

	originalHandle(storageName: string) {
		return this.assets.originalHandle(storageName);
	}

	renderCacheHandle(photoId: string) {
		return this.assets.derivedHandle(renderCacheStorageName(photoId));
	}

	async saveMaskRaster(photoId: string, componentId: string, alpha: Uint8Array) {
		const storageName = `${photoId}-${componentId}.mask`;
		const stored = new Uint8Array(alpha.length);
		stored.set(alpha);
		await this.assets.writeMask(storageName, stored);
		return storageName;
	}

	readMaskRaster(storageName: string) {
		return this.assets.readMask(storageName).then((file) => file.arrayBuffer());
	}

	deleteMaskRasters(storageNames: readonly string[]) {
		return this.assets.deleteMasks(storageNames);
	}

	readThumbnail(storageName: string) {
		return this.assets.readThumbnail(storageName);
	}

	async loadEditDocument(photoId: string) {
		const file = await this.assets.readEdit(editDocumentStorageName(photoId));
		if (!file) return defaultEditDocument(photoId, undefined, { status: 'legacy' });
		return parseEditDocument(JSON.parse(await file.text()), photoId);
	}

	async saveEditDocument(photoId: string, value: EditDocument) {
		const document = editDocumentSchema.parse(value);
		if (document.photoId !== photoId) throw new Error(`Edit document belongs to another photo`);
		const write: EditWrite = {
			storageName: editDocumentStorageName(photoId),
			blob: new Blob([JSON.stringify(document)], { type: 'application/json' })
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

	listPresets() {
		return this.catalog.listPresets();
	}

	savePreset(preset: Preset) {
		return this.catalog.savePreset(presetSchema.parse(preset));
	}

	deletePreset(presetId: string) {
		return this.catalog.deletePreset(presetId);
	}

	async deletePhoto(photoId: string): Promise<CleanupResult> {
		const document = await this.loadEditDocument(photoId).catch(() => null);
		const deletions = await this.catalog.deletePhoto(photoId);
		const [library, masks] = await Promise.all([
			this.flushDeletions(deletions, new Map()),
			this.deleteMaskFiles(maskStorageNames(document))
		]);
		return mergeCleanupResults(library, masks);
	}

	async cleanup(): Promise<CleanupResult> {
		const [references, originals, thumbnails, edits, derived, masks, pending] = await Promise.all([
			this.catalog.storageReferences(),
			this.assets.listOriginals(),
			this.assets.listThumbnails(),
			this.assets.listEdits(),
			this.assets.listDerived(),
			this.assets.listMasks(),
			this.catalog.pendingDeletions()
		]);
		const referencedMasks = await this.referencedMaskStorageNames(references.edits);
		const files = new Map<string, StoredFile>();
		for (const file of originals) files.set(deletionKey('original', file.storageName), file);
		for (const file of thumbnails) files.set(deletionKey('thumbnail', file.storageName), file);
		for (const file of edits) files.set(deletionKey('edit', file.storageName), file);
		for (const file of derived) files.set(deletionKey('derived', file.storageName), file);
		const deletions = new Map<string, PendingDeleteRecord>();
		const orphans = [
			...pending,
			...orphanDeletions('original', originals, references.originals),
			...orphanDeletions('thumbnail', thumbnails, references.thumbnails),
			...orphanDeletions('edit', edits, references.edits),
			...orphanDeletions('derived', derived, references.derived)
		];
		for (const deletion of orphans)
			deletions.set(deletionKey(deletion.kind, deletion.storageName), deletion);
		const [library, maskFiles] = await Promise.all([
			this.flushDeletions([...deletions.values()], files),
			this.deleteMaskFiles(masks.filter(({ storageName }) => !referencedMasks.has(storageName)))
		]);
		return mergeCleanupResults(library, maskFiles);
	}

	storageUsage() {
		return this.assets.usage();
	}

	async resumePendingDeletions(): Promise<CleanupResult> {
		const [deletions, originals, thumbnails, edits, derived] = await Promise.all([
			this.catalog.pendingDeletions(),
			this.assets.listOriginals(),
			this.assets.listThumbnails(),
			this.assets.listEdits(),
			this.assets.listDerived()
		]);
		const files = new Map<string, StoredFile>();
		for (const file of originals) files.set(deletionKey('original', file.storageName), file);
		for (const file of thumbnails) files.set(deletionKey('thumbnail', file.storageName), file);
		for (const file of edits) files.set(deletionKey('edit', file.storageName), file);
		for (const file of derived) files.set(deletionKey('derived', file.storageName), file);
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

	private async deleteStaleRenderCaches(): Promise<CleanupResult> {
		const [references, derived] = await Promise.all([
			this.catalog.storageReferences(),
			this.assets.listDerived()
		]);
		const files = new Map(derived.map((file) => [deletionKey('derived', file.storageName), file]));
		return this.flushDeletions(orphanDeletions('derived', derived, references.derived), files);
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
					else if (deletion.kind === 'edit') await this.assets.deleteEdits([deletion.storageName]);
					else await this.assets.deleteDerived([deletion.storageName]);
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

	private async referencedMaskStorageNames(editStorageNames: ReadonlySet<string>) {
		const storageNames = new Set<string>();
		await Promise.all(
			[...editStorageNames].map(async (editStorageName) => {
				const file = await this.assets.readEdit(editStorageName);
				if (!file) return;
				const parsed = editDocumentSchema.safeParse(JSON.parse(await file.text()));
				if (!parsed.success) return;
				for (const storageName of maskStorageNames(parsed.data)) storageNames.add(storageName);
			})
		);
		return storageNames;
	}

	private async deleteMaskFiles(files: readonly (StoredFile | string)[]): Promise<CleanupResult> {
		const completed: (StoredFile | string)[] = [];
		await Promise.all(
			files.map(async (file) => {
				const storageName = typeof file === 'string' ? file : file.storageName;
				try {
					await this.assets.deleteMasks([storageName]);
					completed.push(file);
				} catch {}
			})
		);
		return {
			deletedFiles: completed.length,
			failedFiles: files.length - completed.length,
			reclaimedBytes: completed.reduce(
				(total, file) => total + (typeof file === 'string' ? 0 : file.size),
				0
			)
		};
	}
}

function maskStorageNames(document: EditDocument | null) {
	return (
		document?.masks.flatMap((mask) =>
			mask.components.flatMap((component) =>
				component.raster ? [component.raster.storageName] : []
			)
		) ?? []
	);
}

function mergeCleanupResults(...results: CleanupResult[]): CleanupResult {
	return results.reduce(
		(total, result) => ({
			deletedFiles: total.deletedFiles + result.deletedFiles,
			failedFiles: total.failedFiles + result.failedFiles,
			reclaimedBytes: total.reclaimedBytes + result.reclaimedBytes
		}),
		{ deletedFiles: 0, failedFiles: 0, reclaimedBytes: 0 }
	);
}

function orphanDeletions(
	kind: PendingDeleteRecord['kind'],
	files: readonly StoredFile[],
	referenced: ReadonlySet<string>
): PendingDeleteRecord[] {
	return files
		.filter(({ storageName }) => !referenced.has(storageName))
		.map(({ storageName }) => pendingDeletion(kind, storageName));
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
