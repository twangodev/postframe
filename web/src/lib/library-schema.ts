import { z } from 'zod';

const LIBRARY_VERSION = 1;

const identifierSchema = z.string().regex(/^[a-z0-9-]+$/);
export const storageNameSchema = z.string().regex(/^[a-z0-9-]+\.[a-z0-9]+$/);
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
	contentHash: z.string().regex(/^[a-f0-9]{64}$/),
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

export const storedPhotoSchema = photoStateSchema
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

export const photoCollectionSchema = z.object({
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
		collections: z.array(photoCollectionSchema),
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
export type PhotoCollection = z.infer<typeof photoCollectionSchema>;
export type LibraryManifest = z.infer<typeof libraryManifestSchema>;
