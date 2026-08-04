import { z } from 'zod';
import {
	defaultLightSettings,
	developSettingsSchema,
	lightSettings,
	lightSettingsSchema,
	type LightSettings
} from './develop-settings.ts';

export const EDIT_DOCUMENT_VERSION = 3;

export const maskKindSchema = z.enum([
	'brush',
	'linear',
	'radial',
	'object',
	'subject',
	'sky',
	'background'
]);
export const maskOperationSchema = z.enum(['add', 'subtract', 'intersect']);
export const maskPromptLabelSchema = z.enum(['foreground', 'background']);

export const normalizedPointSchema = z.object({
	x: z.number().finite().min(0).max(1),
	y: z.number().finite().min(0).max(1)
});

export const maskRasterSchema = z.object({
	storageName: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	digest: z.string().regex(/^[a-f0-9]{64}$/)
});

const maskComponentBaseSchema = z.object({
	id: z.string().min(1),
	operation: maskOperationSchema,
	raster: maskRasterSchema.nullable()
});

export const maskComponentSchema = z.discriminatedUnion('type', [
	maskComponentBaseSchema.extend({
		type: z.literal('ai-subject'),
		inverted: z.boolean(),
		modelVersion: z.string().min(1).nullable()
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('ai-object'),
		modelVersion: z.string().min(1).nullable(),
		prompts: z.array(
			z.object({
				label: maskPromptLabelSchema,
				points: z.array(normalizedPointSchema).min(1)
			})
		)
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('brush'),
		strokes: z.array(
			z.object({
				points: z.array(normalizedPointSchema).min(1),
				size: z.number().finite().positive().max(1),
				feather: z.number().finite().min(0).max(1),
				flow: z.number().finite().min(0).max(1)
			})
		)
	})
]);

export const normalizedCropSchema = z
	.object({
		x: z.number().finite().min(0).max(1),
		y: z.number().finite().min(0).max(1),
		width: z.number().finite().positive().max(1),
		height: z.number().finite().positive().max(1)
	})
	.refine(({ x, width }) => x + width <= 1, { message: 'crop exceeds image width' })
	.refine(({ y, height }) => y + height <= 1, { message: 'crop exceeds image height' });

export const editMaskSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1),
	kind: maskKindSchema,
	visible: z.boolean(),
	components: z.array(maskComponentSchema),
	adjustments: z.object({ light: lightSettingsSchema })
});

export const editDocumentSchema = z
	.object({
		version: z.literal(EDIT_DOCUMENT_VERSION),
		photoId: z.string().min(1),
		adjustments: z.object({ light: lightSettingsSchema }),
		geometry: z.object({
			rotation: z.number().finite().min(-180).max(180),
			flipHorizontal: z.boolean(),
			flipVertical: z.boolean(),
			crop: normalizedCropSchema.nullable()
		}),
		masks: z.array(editMaskSchema)
	})
	.superRefine(({ masks }, context) => {
		const ids = new Set<string>();
		for (const mask of masks) {
			if (ids.has(mask.id)) {
				context.addIssue({
					code: 'custom',
					path: ['masks'],
					message: `duplicate mask ${mask.id}`
				});
			}
			ids.add(mask.id);
		}
	});

export type MaskKind = z.infer<typeof maskKindSchema>;
export type MaskOperation = z.infer<typeof maskOperationSchema>;
export type NormalizedPoint = z.infer<typeof normalizedPointSchema>;
export type MaskComponent = z.infer<typeof maskComponentSchema>;
export type MaskRaster = z.infer<typeof maskRasterSchema>;
export type EditMask = z.infer<typeof editMaskSchema>;
export type NormalizedCrop = z.infer<typeof normalizedCropSchema>;
export type EditDocument = z.infer<typeof editDocumentSchema>;

export function defaultEditDocument(
	photoId: string,
	light: LightSettings = defaultLightSettings()
): EditDocument {
	return {
		version: EDIT_DOCUMENT_VERSION,
		photoId,
		adjustments: { light: lightSettingsSchema.parse(light) },
		geometry: {
			rotation: 0,
			flipHorizontal: false,
			flipVertical: false,
			crop: null
		},
		masks: []
	};
}

export function parseEditDocument(value: unknown, photoId: string): EditDocument {
	const current = editDocumentSchema.safeParse(value);
	if (current.success) {
		if (current.data.photoId !== photoId) throw new Error(`Edit document belongs to another photo`);
		return current.data;
	}

	const legacy = developSettingsSchema.safeParse(value);
	if (legacy.success) return defaultEditDocument(photoId, lightSettings(legacy.data));

	const previous = previousEditDocumentSchema.safeParse(value);
	if (previous.success) {
		if (previous.data.photoId !== photoId)
			throw new Error(`Edit document belongs to another photo`);
		return {
			...previous.data,
			version: EDIT_DOCUMENT_VERSION,
			masks: []
		};
	}
	return editDocumentSchema.parse(value);
}

export function cloneEditDocument(document: EditDocument): EditDocument {
	return editDocumentSchema.parse(document);
}

export function createEditMask(id: string, kind: MaskKind): EditMask {
	const names: Record<MaskKind, string> = {
		brush: 'brush',
		linear: 'linear gradient',
		radial: 'radial gradient',
		object: 'object',
		subject: 'subject',
		sky: 'sky',
		background: 'background'
	};
	return {
		id,
		name: names[kind],
		kind,
		visible: true,
		components: [],
		adjustments: { light: defaultLightSettings() }
	};
}

export function editDocumentStorageName(photoId: string) {
	return `${photoId}.json`;
}

const previousEditDocumentSchema = z.object({
	version: z.literal(2),
	photoId: z.string().min(1),
	adjustments: z.object({ light: lightSettingsSchema }),
	geometry: z.object({
		rotation: z.number().finite().min(-180).max(180),
		flipHorizontal: z.boolean(),
		flipVertical: z.boolean(),
		crop: normalizedCropSchema.nullable()
	}),
	masks: z.array(z.unknown())
});
