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

type PhotoRecord = Omit<StoredPhoto, 'frames'> & { frames: CatalogFrame[] };

interface AssetRecord extends StoredAsset {
	photoId: string;
	frameIndex: number;
	role: 'raw' | 'display';
	contentHash: string | null;
}

interface CollectionRecord extends Omit<PhotoCollection, 'photoIds'> {
	normalizedName: string;
}

interface CollectionPhotoRecord {
	collectionId: string;
	photoId: string;
	position: number;
}

type LibraryStack = LibraryManifest['stacks'][number];
type StackRecord = Omit<LibraryStack, 'photoIds'>;

interface StackPhotoRecord {
	stackId: string;
	photoId: string;
	position: number;
}

export interface PendingDeleteRecord {
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
	pendingDeletes!: Table<PendingDeleteRecord, string>;

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
	}
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

	async clear() {
		await this.database.delete();
	}

	close() {
		this.database.close();
	}
}

function catalogRecords(library: LibraryManifest) {
	const photos: PhotoRecord[] = [];
	const assets: AssetRecord[] = [];

	for (const photo of library.photos) {
		photos.push({
			...photo,
			frames: photo.frames.map((frame) => ({
				rawAssetId: frame.raw?.id ?? null,
				displayAssetId: frame.display?.id ?? null,
				filenameExposureHint: frame.filenameExposureHint
			}))
		});
		for (const [frameIndex, frame] of photo.frames.entries()) {
			if (frame.raw) assets.push(assetRecord(frame.raw, photo.id, frameIndex, 'raw'));
			if (frame.display) assets.push(assetRecord(frame.display, photo.id, frameIndex, 'display'));
		}
	}

	return {
		photos,
		assets,
		collections: library.collections.map(({ photoIds: _, ...collection }) => ({
			...collection,
			normalizedName: normalizeCollectionName(collection.name)
		})),
		collectionPhotos: library.collections.flatMap((collection) =>
			collection.photoIds.map((photoId, position) => ({
				collectionId: collection.id,
				photoId,
				position
			}))
		),
		stacks: library.stacks.map(({ photoIds: _, ...stack }) => stack),
		stackPhotos: library.stacks.flatMap((stack) =>
			stack.photoIds.map((photoId, position) => ({ stackId: stack.id, photoId, position }))
		)
	};
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
		role,
		contentHash: null
	};
}

function hydratePhoto(
	photo: PhotoRecord,
	assetsById: ReadonlyMap<string, AssetRecord>
): StoredPhoto {
	return {
		...photo,
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
	const { photoId: _, frameIndex: __, role: ___, contentHash: ____, ...stored } = asset;
	return { ...stored, source: { ...stored.source } };
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
