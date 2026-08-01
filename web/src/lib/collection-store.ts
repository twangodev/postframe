import { z } from 'zod';

const COLLECTION_VERSION = 2;
const CATALOG_VERSION = 1;
const APP_DIRECTORY = 'postframe';
const COLLECTIONS_DIRECTORY = 'collections';
const CATALOG_FILE = 'catalog.json';
const MANIFEST_FILE = 'collection.json';
const ORIGINALS_DIRECTORY = 'originals';
const THUMBNAILS_DIRECTORY = 'thumbnails';

const identifierSchema = z.string().regex(/^[a-z0-9-]+$/);
const storageNameSchema = z.string().regex(/^[a-z0-9-]+\.[a-z0-9]+$/);
const sourceSchema = z.object({
	kind: z.enum(['raw', 'image']),
	format: z.string().regex(/^[a-z0-9]+$/),
	mediaType: z.string(),
	size: z.number().int().nonnegative(),
	lastModified: z.number().int().nonnegative()
});
const assetSchema = z.object({
	id: identifierSchema,
	storageName: storageNameSchema,
	name: z.string().min(1),
	source: sourceSchema
});
const frameSchema = z
	.object({
		raw: assetSchema.nullable(),
		display: assetSchema.nullable(),
		filenameExposureHint: z.number().finite().nullable()
	})
	.superRefine((frame, context) => {
		if (frame.raw === null && frame.display === null) {
			context.addIssue({ code: 'custom', message: 'A frame needs a source asset' });
		}
		if (frame.raw?.source.kind === 'image') {
			context.addIssue({ code: 'custom', message: 'A RAW slot needs a RAW asset', path: ['raw'] });
		}
		if (frame.display?.source.kind === 'raw') {
			context.addIssue({
				code: 'custom',
				message: 'A display slot needs a display asset',
				path: ['display']
			});
		}
	});
const metadataSchema = z.object({
	orientation: z.number().int().min(0).max(8),
	cameraMake: z.string().nullable(),
	cameraModel: z.string().nullable(),
	lens: z.string().nullable(),
	capturedAt: z.string().nullable(),
	exposureSeconds: z.number().positive().nullable(),
	fNumber: z.number().positive().nullable(),
	iso: z.number().int().positive().nullable(),
	focalLengthMm: z.number().positive().nullable()
});

const photoStateSchema = z.object({
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	rating: z.number().int().min(0).max(5),
	flagged: z.boolean(),
	rejected: z.boolean(),
	colorLabel: z.enum(['none', 'red', 'yellow', 'green', 'blue', 'purple']),
	albumIds: z.array(identifierSchema),
	stackId: identifierSchema.nullable()
});

const storedPhotoSchema = photoStateSchema
	.extend({
		id: identifierSchema,
		kind: z.enum(['display', 'raw', 'raw-pair', 'bracket']),
		name: z.string().min(1),
		frames: z.array(frameSchema).min(1),
		bracketDetection: z.literal('filename-candidate').nullable(),
		thumbnailStorageName: storageNameSchema.nullable(),
		metadata: metadataSchema.nullable()
	})
	.superRefine((photo, context) => {
		const frame = photo.frames[0];
		if (photo.kind !== 'bracket' && photo.frames.length !== 1) {
			context.addIssue({ code: 'custom', message: 'A single photo needs exactly one frame' });
		}
		if (photo.kind === 'bracket' && photo.frames.length < 2) {
			context.addIssue({ code: 'custom', message: 'A bracket needs at least two frames' });
		}
		if (photo.kind === 'display' && (!frame?.display || frame.raw)) {
			context.addIssue({ code: 'custom', message: 'A display photo needs one display asset' });
		}
		if (photo.kind === 'raw' && (!frame?.raw || frame.display)) {
			context.addIssue({ code: 'custom', message: 'A RAW photo needs one RAW asset' });
		}
		if (photo.kind === 'raw-pair' && (!frame?.raw || !frame.display)) {
			context.addIssue({ code: 'custom', message: 'A RAW pair needs RAW and display assets' });
		}
		if ((photo.kind === 'bracket') !== (photo.bracketDetection !== null)) {
			context.addIssue({ code: 'custom', message: 'Bracket detection must match photo kind' });
		}
	});

const legacyStoredPhotoSchema = photoStateSchema.extend({
	id: identifierSchema,
	storageName: storageNameSchema,
	name: z.string().min(1),
	source: sourceSchema
});

const albumSchema = z.object({
	id: identifierSchema,
	name: z.string().min(1)
});

const stackSchema = z.object({
	id: identifierSchema,
	name: z.string().min(1),
	photoIds: z.array(identifierSchema),
	collapsed: z.boolean()
});

const manifestBaseSchema = z.object({
	id: identifierSchema,
	name: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	albums: z.array(albumSchema),
	stacks: z.array(stackSchema)
});

export const collectionManifestSchema = manifestBaseSchema.extend({
	version: z.literal(COLLECTION_VERSION),
	photos: z.array(storedPhotoSchema)
});

const legacyCollectionManifestSchema = manifestBaseSchema.extend({
	version: z.literal(1),
	photos: z.array(legacyStoredPhotoSchema)
});

const persistedCollectionManifestSchema = z
	.union([collectionManifestSchema, legacyCollectionManifestSchema])
	.transform((collection) =>
		collection.version === COLLECTION_VERSION ? collection : migrateCollection(collection)
	);

const collectionSummarySchema = manifestBaseSchema
	.pick({
		id: true,
		name: true,
		createdAt: true,
		updatedAt: true
	})
	.extend({
		photoCount: z.number().int().nonnegative()
	});

const collectionCatalogSchema = z.object({
	version: z.literal(CATALOG_VERSION),
	collections: z.array(collectionSummarySchema)
});

export type StoredAsset = z.infer<typeof assetSchema>;
export type StoredFrame = z.infer<typeof frameSchema>;
export type StoredMetadata = z.infer<typeof metadataSchema>;
export type StoredPhoto = z.infer<typeof storedPhotoSchema>;
export type CollectionManifest = z.infer<typeof collectionManifestSchema>;
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export interface OriginalWrite {
	storageName: string;
	file: File;
}

export interface ThumbnailWrite {
	storageName: string;
	blob: Blob;
}

export class CollectionStore {
	static supported() {
		return (
			typeof navigator !== 'undefined' &&
			'getDirectory' in navigator.storage &&
			typeof navigator.storage.getDirectory === 'function'
		);
	}

	async listCollections(): Promise<CollectionSummary[]> {
		const directory = await this.appDirectory();
		const catalog = await readJson(directory, CATALOG_FILE, collectionCatalogSchema);
		return catalog?.collections ?? [];
	}

	async loadCollection(collectionId: string): Promise<CollectionManifest> {
		const directory = await this.collectionDirectory(collectionId, false);
		const collection = await readJson(directory, MANIFEST_FILE, persistedCollectionManifestSchema);
		if (!collection) throw new Error(`Collection ${collectionId} has no manifest`);
		return collection;
	}

	async readOriginal(collectionId: string, storageName: string): Promise<File> {
		return this.originalHandle(collectionId, storageName).then((handle) => handle.getFile());
	}

	async originalHandle(collectionId: string, storageName: string) {
		return this.collectionFileHandle(collectionId, ORIGINALS_DIRECTORY, storageName);
	}

	async readThumbnail(collectionId: string, storageName: string): Promise<File> {
		return this.collectionFileHandle(collectionId, THUMBNAILS_DIRECTORY, storageName).then(
			(handle) => handle.getFile()
		);
	}

	async clearAll() {
		const root = await navigator.storage.getDirectory();
		try {
			await root.removeEntry(APP_DIRECTORY, { recursive: true });
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
	}

	async saveCollection(
		collection: CollectionManifest,
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) {
		const parsed = collectionManifestSchema.parse(collection);
		const directory = await this.collectionDirectory(parsed.id, true);
		const originalsDirectory = await directory.getDirectoryHandle(ORIGINALS_DIRECTORY, {
			create: true
		});
		const assetStorageNames = new Set(
			parsed.photos.flatMap((photo) =>
				photo.frames.flatMap((frame) =>
					[frame.raw?.storageName, frame.display?.storageName].filter(
						(storageName): storageName is string => storageName !== undefined
					)
				)
			)
		);

		for (const original of originals) {
			if (!assetStorageNames.has(original.storageName)) {
				throw new Error(`Original ${original.storageName} is not part of collection ${parsed.id}`);
			}
			await writeFile(originalsDirectory, original.storageName, original.file);
		}

		if (thumbnails.length > 0) {
			const thumbnailsDirectory = await directory.getDirectoryHandle(THUMBNAILS_DIRECTORY, {
				create: true
			});
			const thumbnailStorageNames = new Set(
				parsed.photos.flatMap((photo) =>
					photo.thumbnailStorageName ? [photo.thumbnailStorageName] : []
				)
			);
			for (const thumbnail of thumbnails) {
				if (!thumbnailStorageNames.has(thumbnail.storageName)) {
					throw new Error(
						`Thumbnail ${thumbnail.storageName} is not part of collection ${parsed.id}`
					);
				}
				await writeFile(thumbnailsDirectory, thumbnail.storageName, thumbnail.blob);
			}
		}

		await writeJson(directory, MANIFEST_FILE, parsed);
		await this.updateCatalog(parsed);
	}

	private async collectionFileHandle(collectionId: string, folder: string, storageName: string) {
		storageNameSchema.parse(storageName);
		const directory = await this.collectionDirectory(collectionId, false);
		const files = await directory.getDirectoryHandle(folder);
		return files.getFileHandle(storageName);
	}

	private async updateCatalog(collection: CollectionManifest) {
		const directory = await this.appDirectory();
		const catalog = (await readJson(directory, CATALOG_FILE, collectionCatalogSchema)) ?? {
			version: CATALOG_VERSION,
			collections: []
		};
		const summary = {
			id: collection.id,
			name: collection.name,
			createdAt: collection.createdAt,
			updatedAt: collection.updatedAt,
			photoCount: collection.photos.length
		};

		catalog.collections = [
			summary,
			...catalog.collections.filter((candidate) => candidate.id !== collection.id)
		].sort((left, right) => right.updatedAt - left.updatedAt);
		await writeJson(directory, CATALOG_FILE, collectionCatalogSchema.parse(catalog));
	}

	private async appDirectory() {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(APP_DIRECTORY, { create: true });
	}

	private async collectionDirectory(collectionId: string, create: boolean) {
		identifierSchema.parse(collectionId);
		const app = await this.appDirectory();
		const collections = await app.getDirectoryHandle(COLLECTIONS_DIRECTORY, { create: true });
		return collections.getDirectoryHandle(collectionId, { create });
	}
}

function migrateCollection(
	collection: z.infer<typeof legacyCollectionManifestSchema>
): CollectionManifest {
	return {
		...collection,
		version: COLLECTION_VERSION,
		photos: collection.photos.map(({ storageName, source, ...photo }) => ({
			...photo,
			kind: source.kind === 'raw' ? 'raw' : 'display',
			frames: [
				{
					raw:
						source.kind === 'raw'
							? { id: `${photo.id}-asset`, storageName, name: photo.name, source }
							: null,
					display:
						source.kind === 'image'
							? { id: `${photo.id}-asset`, storageName, name: photo.name, source }
							: null,
					filenameExposureHint: null
				}
			],
			bracketDetection: null,
			thumbnailStorageName: null,
			metadata: null
		}))
	};
}

async function readJson<T>(
	directory: FileSystemDirectoryHandle,
	name: string,
	schema: z.ZodType<T>
): Promise<T | null> {
	try {
		const handle = await directory.getFileHandle(name);
		const file = await handle.getFile();
		return schema.parse(JSON.parse(await file.text()));
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

function isNotFoundError(error: unknown) {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

async function writeJson(directory: FileSystemDirectoryHandle, name: string, value: unknown) {
	await writeFile(directory, name, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFile(
	directory: FileSystemDirectoryHandle,
	name: string,
	contents: FileSystemWriteChunkType
) {
	const handle = await directory.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	try {
		await writable.write(contents);
		await writable.close();
	} catch (error) {
		await writable.abort();
		throw error;
	}
}
