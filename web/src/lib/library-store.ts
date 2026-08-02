import { z } from 'zod';

const LIBRARY_VERSION = 1;
const APP_DIRECTORY = 'postframe';
const LIBRARY_FILE = 'library.json';
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
	stackId: identifierSchema.nullable()
});

const storedPhotoSchema = photoStateSchema
	.extend({
		id: identifierSchema,
		kind: z.enum(['display', 'raw', 'raw-pair', 'bracket']),
		name: z.string().min(1),
		importedAt: z.number().int().nonnegative(),
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

const collectionSchema = z.object({
	id: identifierSchema,
	name: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	photoIds: z.array(identifierSchema)
});

const stackSchema = z.object({
	id: identifierSchema,
	name: z.string().min(1),
	photoIds: z.array(identifierSchema),
	collapsed: z.boolean()
});

export const libraryManifestSchema = z
	.object({
		version: z.literal(LIBRARY_VERSION),
		createdAt: z.number().int().nonnegative(),
		updatedAt: z.number().int().nonnegative(),
		photos: z.array(storedPhotoSchema),
		collections: z.array(collectionSchema),
		stacks: z.array(stackSchema)
	})
	.superRefine((library, context) => {
		const photoIds = new Set<string>();
		for (const [index, photo] of library.photos.entries()) {
			if (photoIds.has(photo.id)) {
				context.addIssue({
					code: 'custom',
					message: `Duplicate photo ${photo.id}`,
					path: ['photos', index, 'id']
				});
			}
			photoIds.add(photo.id);
		}
		const collectionIds = new Set<string>();
		for (const [index, collection] of library.collections.entries()) {
			if (collectionIds.has(collection.id)) {
				context.addIssue({
					code: 'custom',
					message: `Duplicate collection ${collection.id}`,
					path: ['collections', index, 'id']
				});
			}
			collectionIds.add(collection.id);
			const memberIds = new Set<string>();
			for (const photoId of collection.photoIds) {
				if (!photoIds.has(photoId)) {
					context.addIssue({
						code: 'custom',
						message: `Unknown photo ${photoId}`,
						path: ['collections', index, 'photoIds']
					});
				}
				if (memberIds.has(photoId)) {
					context.addIssue({
						code: 'custom',
						message: `Duplicate member ${photoId}`,
						path: ['collections', index, 'photoIds']
					});
				}
				memberIds.add(photoId);
			}
		}
		for (const [index, stack] of library.stacks.entries()) {
			for (const photoId of stack.photoIds) {
				if (!photoIds.has(photoId)) {
					context.addIssue({
						code: 'custom',
						message: `Unknown photo ${photoId}`,
						path: ['stacks', index, 'photoIds']
					});
				}
			}
		}
	});

export type StoredAsset = z.infer<typeof assetSchema>;
export type StoredFrame = z.infer<typeof frameSchema>;
export type StoredMetadata = z.infer<typeof metadataSchema>;
export type StoredPhoto = z.infer<typeof storedPhotoSchema>;
export type PhotoCollection = z.infer<typeof collectionSchema>;
export type LibraryManifest = z.infer<typeof libraryManifestSchema>;

export interface OriginalWrite {
	storageName: string;
	file: File;
}

export interface ThumbnailWrite {
	storageName: string;
	blob: Blob;
}

export class LibraryStore {
	static supported() {
		return (
			typeof navigator !== 'undefined' &&
			'getDirectory' in navigator.storage &&
			typeof navigator.storage.getDirectory === 'function'
		);
	}

	async loadLibrary(): Promise<LibraryManifest | null> {
		const directory = await this.appDirectory();
		return readJson(directory, LIBRARY_FILE, libraryManifestSchema);
	}

	async readOriginal(storageName: string): Promise<File> {
		return this.originalHandle(storageName).then((handle) => handle.getFile());
	}

	async originalHandle(storageName: string) {
		return this.libraryFileHandle(ORIGINALS_DIRECTORY, storageName);
	}

	async readThumbnail(storageName: string): Promise<File> {
		return this.libraryFileHandle(THUMBNAILS_DIRECTORY, storageName).then((handle) =>
			handle.getFile()
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

	async saveLibrary(
		library: LibraryManifest,
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) {
		const parsed = libraryManifestSchema.parse(library);
		const directory = await this.appDirectory();
		const assetStorageNames = new Set(
			parsed.photos.flatMap((photo) =>
				photo.frames.flatMap((frame) =>
					[frame.raw?.storageName, frame.display?.storageName].filter(
						(storageName): storageName is string => storageName !== undefined
					)
				)
			)
		);

		if (originals.length > 0) {
			const originalsDirectory = await directory.getDirectoryHandle(ORIGINALS_DIRECTORY, {
				create: true
			});
			for (const original of originals) {
				if (!assetStorageNames.has(original.storageName)) {
					throw new Error(`Original ${original.storageName} is not part of the library`);
				}
				await writeFile(originalsDirectory, original.storageName, original.file);
			}
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
					throw new Error(`Thumbnail ${thumbnail.storageName} is not part of the library`);
				}
				await writeFile(thumbnailsDirectory, thumbnail.storageName, thumbnail.blob);
			}
		}

		await writeJson(directory, LIBRARY_FILE, parsed);
	}

	private async libraryFileHandle(folder: string, storageName: string) {
		storageNameSchema.parse(storageName);
		const directory = await this.appDirectory();
		const files = await directory.getDirectoryHandle(folder);
		return files.getFileHandle(storageName);
	}

	private async appDirectory() {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(APP_DIRECTORY, { create: true });
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
