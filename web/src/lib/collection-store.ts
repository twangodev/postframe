import { z } from 'zod';
import { PHOTO_EXTENSIONS } from './photo-source';

const COLLECTION_VERSION = 1;
const APP_DIRECTORY = 'postframe';
const COLLECTIONS_DIRECTORY = 'collections';
const CATALOG_FILE = 'catalog.json';
const MANIFEST_FILE = 'collection.json';
const ORIGINALS_DIRECTORY = 'originals';

const identifierSchema = z.string().regex(/^[a-z0-9-]+$/);
const sourceSchema = z.object({
	kind: z.enum(['raw', 'image']),
	format: z.enum(PHOTO_EXTENSIONS),
	mediaType: z.string(),
	size: z.number().int().nonnegative(),
	lastModified: z.number().int().nonnegative()
});

const storedPhotoSchema = z.object({
	id: identifierSchema,
	storageName: z.string().regex(/^[a-z0-9-]+\.[a-z0-9]+$/),
	name: z.string().min(1),
	source: sourceSchema,
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	rating: z.number().int().min(0).max(5),
	flagged: z.boolean(),
	rejected: z.boolean(),
	colorLabel: z.enum(['none', 'red', 'yellow', 'green', 'blue', 'purple']),
	albumIds: z.array(identifierSchema),
	stackId: identifierSchema.nullable()
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

export const collectionManifestSchema = z.object({
	version: z.literal(COLLECTION_VERSION),
	id: identifierSchema,
	name: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	photos: z.array(storedPhotoSchema),
	albums: z.array(albumSchema),
	stacks: z.array(stackSchema)
});

const collectionSummarySchema = collectionManifestSchema
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
	version: z.literal(COLLECTION_VERSION),
	collections: z.array(collectionSummarySchema)
});

export type StoredPhoto = z.infer<typeof storedPhotoSchema>;
export type CollectionManifest = z.infer<typeof collectionManifestSchema>;
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export interface OriginalWrite {
	storageName: string;
	file: File;
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
		const collection = await readJson(directory, MANIFEST_FILE, collectionManifestSchema);
		if (!collection) throw new Error(`Collection ${collectionId} has no manifest`);
		return collection;
	}

	async readOriginal(collectionId: string, storageName: string): Promise<File> {
		const directory = await this.collectionDirectory(collectionId, false);
		const originals = await directory.getDirectoryHandle(ORIGINALS_DIRECTORY);
		return originals.getFileHandle(storageName).then((handle) => handle.getFile());
	}

	async saveCollection(collection: CollectionManifest, originals: readonly OriginalWrite[] = []) {
		const parsed = collectionManifestSchema.parse(collection);
		const directory = await this.collectionDirectory(parsed.id, true);
		const originalsDirectory = await directory.getDirectoryHandle(ORIGINALS_DIRECTORY, {
			create: true
		});

		for (const original of originals) {
			if (!parsed.photos.some((photo) => photo.storageName === original.storageName)) {
				throw new Error(`Original ${original.storageName} is not part of collection ${parsed.id}`);
			}
			await writeFile(originalsDirectory, original.storageName, original.file);
		}

		await writeJson(directory, MANIFEST_FILE, parsed);
		await this.updateCatalog(parsed);
	}

	private async updateCatalog(collection: CollectionManifest) {
		const directory = await this.appDirectory();
		const catalog = (await readJson(directory, CATALOG_FILE, collectionCatalogSchema)) ?? {
			version: COLLECTION_VERSION,
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
		if (error instanceof DOMException && error.name === 'NotFoundError') return null;
		throw error;
	}
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
