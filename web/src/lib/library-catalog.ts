import Dexie, { type Table } from 'dexie';
import {
	libraryManifestSchema,
	type LibraryManifest,
	type PhotoCollection,
	type StoredAsset,
	type StoredPhoto
} from './library-schema.ts';

const DATABASE_NAME = 'postframe-catalog';
const LIBRARY_ID = 'library';

interface LibraryRecord {
	id: typeof LIBRARY_ID;
	createdAt: number;
	updatedAt: number;
}

interface CatalogFrame {
	rawAssetId: string | null;
	displayAssetId: string | null;
	filenameExposureHint: number | null;
}

type PhotoRecord = Omit<StoredPhoto, 'frames'> & {
	fingerprint: string;
	frames: CatalogFrame[];
};

interface AssetRecord extends StoredAsset {
	photoId: string;
	frameIndex: number;
	role: 'raw' | 'display';
}

interface CollectionRecord extends Omit<PhotoCollection, 'photoIds'> {
	normalizedName: string;
}

interface CollectionPhotoRecord {
	collectionId: string;
	photoId: string;
	position: number;
}

export type LibraryStack = LibraryManifest['stacks'][number];
type StackRecord = Omit<LibraryStack, 'photoIds'>;

interface StackPhotoRecord {
	stackId: string;
	photoId: string;
	position: number;
}

export interface PendingDeleteRecord {
	kind: 'original' | 'thumbnail';
	storageName: string;
	queuedAt: number;
}

export class PostframeDatabase extends Dexie {
	library!: Table<LibraryRecord, string>;
	photos!: Table<PhotoRecord, string>;
	assets!: Table<AssetRecord, string>;
	collections!: Table<CollectionRecord, string>;
	collectionPhotos!: Table<CollectionPhotoRecord, [string, string]>;
	stacks!: Table<StackRecord, string>;
	stackPhotos!: Table<StackPhotoRecord, [string, string]>;
	pendingDeletes!: Table<PendingDeleteRecord, [PendingDeleteRecord['kind'], string]>;

	constructor(name = DATABASE_NAME) {
		super(name);
		this.version(1).stores({
			library: '&id',
			photos:
				'&id, importedAt, metadata.capturedAt, flagged, rejected, rating, stackId, [kind+importedAt]',
			assets: '&id, &storageName, contentHash, photoId, [photoId+frameIndex], role',
			collections: '&id, &normalizedName, updatedAt',
			collectionPhotos: '[collectionId+photoId], photoId, [collectionId+position]',
			stacks: '&id',
			stackPhotos: '[stackId+photoId], photoId, [stackId+position]',
			pendingDeletes: '&storageName, queuedAt'
		});
		this.version(2).stores({
			library: '&id',
			photos:
				'&id, &fingerprint, importedAt, metadata.capturedAt, flagged, rejected, rating, stackId, [kind+importedAt]',
			assets: '&id, &storageName, &contentHash, photoId, [photoId+frameIndex], role',
			collections: '&id, &normalizedName, updatedAt',
			collectionPhotos: '[collectionId+photoId], photoId, [collectionId+position]',
			stacks: '&id',
			stackPhotos: '[stackId+photoId], photoId, [stackId+position]',
			pendingDeletes: '&storageName, queuedAt'
		});
		this.version(3).stores({
			library: '&id',
			photos:
				'&id, &fingerprint, importedAt, metadata.capturedAt, flagged, rejected, rating, stackId, [kind+importedAt]',
			assets: '&id, &storageName, &contentHash, photoId, [photoId+frameIndex], role',
			collections: '&id, &normalizedName, updatedAt',
			collectionPhotos: '[collectionId+photoId], photoId, [collectionId+position]',
			stacks: '&id',
			stackPhotos: '[stackId+photoId], photoId, [stackId+position]',
			pendingDeletes: '[kind+storageName], queuedAt'
		});
		this.version(4).stores({
			library: '&id',
			photos:
				'&id, &fingerprint, importedAt, metadata.capturedAt, flagged, rejected, rating, stackId, [kind+importedAt]',
			assets: '&id, &storageName, contentHash, photoId, [photoId+frameIndex], role',
			collections: '&id, &normalizedName, updatedAt',
			collectionPhotos: '[collectionId+photoId], photoId, [collectionId+position]',
			stacks: '&id',
			stackPhotos: '[stackId+photoId], photoId, [stackId+position]',
			pendingDeletes: '[kind+storageName], queuedAt'
		});
	}
}

export interface ImportResolution {
	additions: StoredPhoto[];
	photoIds: ReadonlyMap<string, string>;
}

export class LibraryCatalog {
	readonly database: PostframeDatabase;

	constructor(name?: string) {
		this.database = new PostframeDatabase(name);
	}

	async loadLibrary(): Promise<LibraryManifest | null> {
		const library = await this.database.library.get(LIBRARY_ID);
		if (!library) return null;

		const [photos, assets, collections, collectionPhotos, stacks, stackPhotos] = await Promise.all([
			this.database.photos.toArray(),
			this.database.assets.toArray(),
			this.database.collections.toArray(),
			this.database.collectionPhotos.toArray(),
			this.database.stacks.toArray(),
			this.database.stackPhotos.toArray()
		]);
		const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

		return libraryManifestSchema.parse({
			version: 1,
			createdAt: library.createdAt,
			updatedAt: library.updatedAt,
			photos: photos.map((photo) => hydratePhoto(photo, assetsById)),
			collections: collections.map(({ normalizedName: _, ...collection }) => ({
				...collection,
				photoIds: orderedMembers(
					collectionPhotos.filter((member) => member.collectionId === collection.id)
				)
			})),
			stacks: stacks.map((stack) => ({
				...stack,
				photoIds: orderedMembers(stackPhotos.filter((member) => member.stackId === stack.id))
			}))
		});
	}

	async saveLibrary(value: LibraryManifest) {
		const library = libraryManifestSchema.parse(value);
		const records = catalogRecords(library);

		await this.database.transaction(
			'rw',
			[
				this.database.library,
				this.database.photos,
				this.database.assets,
				this.database.collections,
				this.database.collectionPhotos,
				this.database.stacks,
				this.database.stackPhotos
			],
			async () => {
				await Promise.all([
					this.database.photos.clear(),
					this.database.assets.clear(),
					this.database.collections.clear(),
					this.database.collectionPhotos.clear(),
					this.database.stacks.clear(),
					this.database.stackPhotos.clear()
				]);
				await this.database.library.put({
					id: LIBRARY_ID,
					createdAt: library.createdAt,
					updatedAt: library.updatedAt
				});
				await bulkPut(this.database.photos, records.photos);
				await bulkPut(this.database.assets, records.assets);
				await bulkPut(this.database.collections, records.collections);
				await bulkPut(this.database.collectionPhotos, records.collectionPhotos);
				await bulkPut(this.database.stacks, records.stacks);
				await bulkPut(this.database.stackPhotos, records.stackPhotos);
			}
		);
	}

	async resolveImports(photos: readonly StoredPhoto[]): Promise<ImportResolution> {
		const candidates = photos.map((photo) => ({ photo, fingerprint: photoFingerprint(photo) }));
		const fingerprints = [...new Set(candidates.map(({ fingerprint }) => fingerprint))];
		const existing =
			fingerprints.length > 0
				? await this.database.photos.where('fingerprint').anyOf(fingerprints).toArray()
				: [];
		const resolvedByFingerprint = new Map(
			existing.map((photo) => [photo.fingerprint, photo.id] as const)
		);
		const additions: StoredPhoto[] = [];
		const photoIds = new Map<string, string>();

		for (const { photo, fingerprint } of candidates) {
			const resolvedId = resolvedByFingerprint.get(fingerprint);
			if (resolvedId) {
				photoIds.set(photo.id, resolvedId);
				continue;
			}
			resolvedByFingerprint.set(fingerprint, photo.id);
			photoIds.set(photo.id, photo.id);
			additions.push(photo);
		}

		return { additions, photoIds };
	}

	async addPhotos(
		libraryCreatedAt: number,
		photos: readonly StoredPhoto[],
		collection: PhotoCollection | null = null
	) {
		const photoRecords = photos.map(photoRecord);
		const assets = photos.flatMap(photoAssets);

		await this.database.transaction(
			'rw',
			[
				this.database.library,
				this.database.photos,
				this.database.assets,
				this.database.collections,
				this.database.collectionPhotos
			],
			async () => {
				const now = Date.now();
				const library = await this.database.library.get(LIBRARY_ID);
				await this.database.library.put({
					id: LIBRARY_ID,
					createdAt: library?.createdAt ?? libraryCreatedAt,
					updatedAt: now
				});
				await bulkAdd(this.database.photos, photoRecords);
				await bulkAdd(this.database.assets, assets);
				if (collection) {
					await this.database.collections.add(collectionRecord(collection));
					await bulkAdd(this.database.collectionPhotos, collectionPhotoRecords(collection));
				}
			}
		);
	}

	async updatePhotoState(photo: StoredPhoto) {
		await this.database.transaction(
			'rw',
			[this.database.library, this.database.photos],
			async () => {
				const updated = await this.database.photos.update(photo.id, {
					rating: photo.rating,
					flagged: photo.flagged,
					rejected: photo.rejected,
					colorLabel: photo.colorLabel,
					stackId: photo.stackId
				});
				if (updated === 0) throw new Error(`Photo ${photo.id} is missing from the catalog`);
				await this.touchLibrary();
			}
		);
	}

	async saveCollection(collection: PhotoCollection) {
		await this.database.transaction(
			'rw',
			[
				this.database.library,
				this.database.photos,
				this.database.collections,
				this.database.collectionPhotos
			],
			async () => {
				const members = await this.database.photos.bulkGet(collection.photoIds);
				const missingIndex = members.findIndex((photo) => photo === undefined);
				if (missingIndex >= 0) {
					throw new Error(`Photo ${collection.photoIds[missingIndex]} is missing from the catalog`);
				}
				await this.database.collections.put(collectionRecord(collection));
				await this.database.collectionPhotos.where('collectionId').equals(collection.id).delete();
				await bulkAdd(this.database.collectionPhotos, collectionPhotoRecords(collection));
				await this.touchLibrary();
			}
		);
	}

	async deleteCollection(collectionId: string) {
		await this.database.transaction(
			'rw',
			[this.database.library, this.database.collections, this.database.collectionPhotos],
			async () => {
				await this.database.collectionPhotos.where('collectionId').equals(collectionId).delete();
				await this.database.collections.delete(collectionId);
				await this.touchLibrary();
			}
		);
	}

	async saveStacks(
		stacks: readonly LibraryStack[],
		changedPhotos: ReadonlyMap<string, string | null>
	) {
		await this.database.transaction(
			'rw',
			[
				this.database.library,
				this.database.photos,
				this.database.stacks,
				this.database.stackPhotos
			],
			async () => {
				await Promise.all([this.database.stacks.clear(), this.database.stackPhotos.clear()]);
				await bulkAdd(
					this.database.stacks,
					stacks.map(({ photoIds: _, ...stack }) => stack)
				);
				await bulkAdd(
					this.database.stackPhotos,
					stacks.flatMap((stack) =>
						stack.photoIds.map((photoId, position) => ({ stackId: stack.id, photoId, position }))
					)
				);
				for (const [photoId, stackId] of changedPhotos) {
					const updated = await this.database.photos.update(photoId, { stackId });
					if (updated === 0) throw new Error(`Photo ${photoId} is missing from the catalog`);
				}
				await this.touchLibrary();
			}
		);
	}

	async deletePhoto(photoId: string) {
		return this.database.transaction(
			'rw',
			[
				this.database.library,
				this.database.photos,
				this.database.assets,
				this.database.collectionPhotos,
				this.database.stacks,
				this.database.stackPhotos,
				this.database.pendingDeletes
			],
			async () => {
				const photo = await this.database.photos.get(photoId);
				if (!photo) return [];
				const assets = await this.database.assets.where('photoId').equals(photoId).toArray();
				const now = Date.now();
				const pending: PendingDeleteRecord[] = [
					...assets.map(({ storageName }) => ({
						kind: 'original' as const,
						storageName,
						queuedAt: now
					})),
					...(photo.thumbnailStorageName
						? [
								{
									kind: 'thumbnail' as const,
									storageName: photo.thumbnailStorageName,
									queuedAt: now
								}
							]
						: [])
				];
				await bulkPut(this.database.pendingDeletes, pending);
				await Promise.all([
					this.database.collectionPhotos.where('photoId').equals(photoId).delete(),
					this.database.stackPhotos.where('photoId').equals(photoId).delete(),
					this.database.assets.bulkDelete(assets.map(({ id }) => id)),
					this.database.photos.delete(photoId)
				]);
				if (photo.stackId) await this.collapseSmallStack(photo.stackId);
				await this.touchLibrary();
				return pending;
			}
		);
	}

	pendingDeletions() {
		return this.database.pendingDeletes.toArray();
	}

	async completeDeletions(deletions: readonly PendingDeleteRecord[]) {
		if (deletions.length === 0) return;
		await this.database.pendingDeletes.bulkDelete(
			deletions.map(({ kind, storageName }) => [kind, storageName])
		);
	}

	async storageReferences() {
		const [assets, photos] = await Promise.all([
			this.database.assets.toArray(),
			this.database.photos.toArray()
		]);
		return {
			originals: new Set(assets.map(({ storageName }) => storageName)),
			thumbnails: new Set(
				photos.flatMap((photo) => (photo.thumbnailStorageName ? [photo.thumbnailStorageName] : []))
			)
		};
	}

	async clear() {
		await this.database.delete();
	}

	close() {
		this.database.close();
	}

	private async touchLibrary() {
		const library = await this.database.library.get(LIBRARY_ID);
		if (library) await this.database.library.update(LIBRARY_ID, { updatedAt: Date.now() });
	}

	private async collapseSmallStack(stackId: string) {
		const remaining = await this.database.stackPhotos.where('stackId').equals(stackId).toArray();
		if (remaining.length >= 2) return;
		await this.database.stackPhotos.where('stackId').equals(stackId).delete();
		await this.database.stacks.delete(stackId);
		for (const { photoId } of remaining) {
			await this.database.photos.update(photoId, { stackId: null });
		}
	}
}

function catalogRecords(library: LibraryManifest) {
	const photos: PhotoRecord[] = [];
	const assets: AssetRecord[] = [];

	for (const photo of library.photos) {
		photos.push(photoRecord(photo));
		assets.push(...photoAssets(photo));
	}

	return {
		photos,
		assets,
		collections: library.collections.map(collectionRecord),
		collectionPhotos: library.collections.flatMap(collectionPhotoRecords),
		stacks: library.stacks.map(({ photoIds: _, ...stack }) => stack),
		stackPhotos: library.stacks.flatMap((stack) =>
			stack.photoIds.map((photoId, position) => ({ stackId: stack.id, photoId, position }))
		)
	};
}

function photoRecord(photo: StoredPhoto): PhotoRecord {
	return {
		...photo,
		fingerprint: photoFingerprint(photo),
		frames: photo.frames.map((frame) => ({
			rawAssetId: frame.raw?.id ?? null,
			displayAssetId: frame.display?.id ?? null,
			filenameExposureHint: frame.filenameExposureHint
		}))
	};
}

function photoAssets(photo: StoredPhoto) {
	return photo.frames.flatMap((frame, frameIndex) => {
		const assets: AssetRecord[] = [];
		if (frame.raw) assets.push(assetRecord(frame.raw, photo.id, frameIndex, 'raw'));
		if (frame.display) assets.push(assetRecord(frame.display, photo.id, frameIndex, 'display'));
		return assets;
	});
}

function photoFingerprint(photo: StoredPhoto) {
	return [
		photo.kind,
		...photo.frames.map((frame) =>
			[
				frame.raw?.contentHash ?? '',
				frame.display?.contentHash ?? '',
				frame.filenameExposureHint ?? ''
			].join(':')
		)
	].join('|');
}

function collectionRecord({ photoIds: _, ...collection }: PhotoCollection): CollectionRecord {
	return { ...collection, normalizedName: normalizeCollectionName(collection.name) };
}

function collectionPhotoRecords(collection: PhotoCollection): CollectionPhotoRecord[] {
	return collection.photoIds.map((photoId, position) => ({
		collectionId: collection.id,
		photoId,
		position
	}));
}

function assetRecord(
	asset: StoredAsset,
	photoId: string,
	frameIndex: number,
	role: AssetRecord['role']
): AssetRecord {
	return {
		...asset,
		source: { ...asset.source },
		photoId,
		frameIndex,
		role
	};
}

function hydratePhoto(
	photo: PhotoRecord,
	assetsById: ReadonlyMap<string, AssetRecord>
): StoredPhoto {
	return {
		...storedPhotoRecord(photo),
		frames: photo.frames.map((frame) => ({
			raw: storedAsset(frame.rawAssetId, assetsById),
			display: storedAsset(frame.displayAssetId, assetsById),
			filenameExposureHint: frame.filenameExposureHint
		}))
	};
}

function storedAsset(
	id: string | null,
	assetsById: ReadonlyMap<string, AssetRecord>
): StoredAsset | null {
	if (!id) return null;
	const asset = assetsById.get(id);
	if (!asset) throw new Error(`Asset ${id} is missing from the catalog`);
	const { photoId: _, frameIndex: __, role: ___, ...stored } = asset;
	return { ...stored, source: { ...stored.source } };
}

function storedPhotoRecord({ fingerprint: _, ...photo }: PhotoRecord) {
	return photo;
}

function orderedMembers(records: Array<{ photoId: string; position: number }>) {
	return records
		.sort((left, right) => left.position - right.position)
		.map(({ photoId }) => photoId);
}

function normalizeCollectionName(name: string) {
	return name.normalize('NFKC').trim().toLocaleLowerCase();
}

async function bulkPut<T, TKey>(table: Table<T, TKey>, values: readonly T[]) {
	if (values.length > 0) await table.bulkPut([...values]);
}

async function bulkAdd<T, TKey>(table: Table<T, TKey>, values: readonly T[]) {
	if (values.length > 0) await table.bulkAdd([...values]);
}
