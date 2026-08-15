import { z } from 'zod';
import {
	colorSettingsSchema,
	defaultColorSettings,
	defaultLightSettings,
	developSettingsSchema,
	lightSettings,
	lightSettingsSchema,
	type LightSettings
} from './develop-settings.ts';
import { defaultMaskEdgeSettings, maskEdgeSettingsSchema } from './mask-edge-settings.ts';

export const EDIT_DOCUMENT_VERSION = 7;

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

const boundedRegionSchema = (subject: string) =>
	z
		.object({
			x: z.number().finite().min(0).max(1),
			y: z.number().finite().min(0).max(1),
			width: z.number().finite().positive().max(1),
			height: z.number().finite().positive().max(1)
		})
		.refine(({ x, width }) => x + width <= 1, { message: `${subject} exceeds image width` })
		.refine(({ y, height }) => y + height <= 1, { message: `${subject} exceeds image height` });

export const normalizedRegionSchema = boundedRegionSchema('region');
export const normalizedCropSchema = boundedRegionSchema('crop');

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
		alternatives: z
			.object({
				index: z.number().int().nonnegative(),
				count: z.number().int().positive()
			})
			.refine(({ index, count }) => index < count, { message: 'mask alternative is out of range' })
			.optional(),
		prompts: z.array(
			z.object({
				label: maskPromptLabelSchema,
				points: z.array(normalizedPointSchema).min(1)
			})
		)
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('ai-instance'),
		label: z.string().min(1),
		box: normalizedRegionSchema,
		modelVersion: z.string().min(1).nullable(),
		alternatives: z
			.object({
				index: z.number().int().nonnegative(),
				count: z.number().int().positive()
			})
			.refine(({ index, count }) => index < count, { message: 'mask alternative is out of range' })
			.optional()
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
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('linear'),
		start: normalizedPointSchema,
		end: normalizedPointSchema
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('radial'),
		center: normalizedPointSchema,
		radius: z.number().finite().positive().max(1),
		feather: z.number().finite().min(0).max(1)
	})
]);

const versionThreeEditMaskSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1),
	kind: maskKindSchema,
	visible: z.boolean(),
	components: z.array(maskComponentSchema),
	adjustments: z.object({ light: lightSettingsSchema })
});

const versionSixEditMaskSchema = versionThreeEditMaskSchema.extend({
	edge: maskEdgeSettingsSchema
});

export const editMaskSchema = versionSixEditMaskSchema.extend({
	adjustments: z.object({ light: lightSettingsSchema, color: colorSettingsSchema })
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
export type NormalizedRegion = z.infer<typeof normalizedRegionSchema>;
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

	const versionFourToSix = versionFourToSixEditDocumentSchema.safeParse(value);
	if (versionFourToSix.success) {
		if (versionFourToSix.data.photoId !== photoId)
			throw new Error(`Edit document belongs to another photo`);
		return editDocumentSchema.parse({
			...versionFourToSix.data,
			version: EDIT_DOCUMENT_VERSION,
			masks: versionFourToSix.data.masks.map(maskWithDefaultColor)
		});
	}

	const versionThree = versionThreeEditDocumentSchema.safeParse(value);
	if (versionThree.success) {
		if (versionThree.data.photoId !== photoId)
			throw new Error(`Edit document belongs to another photo`);
		return editDocumentSchema.parse({
			...versionThree.data,
			version: EDIT_DOCUMENT_VERSION,
			masks: versionThree.data.masks.map((mask) =>
				maskWithDefaultColor({ ...mask, edge: defaultMaskEdgeSettings() })
			)
		});
	}

	const previous = versionTwoEditDocumentSchema.safeParse(value);
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

export function cloneEditMask(mask: EditMask): EditMask {
	return editMaskSchema.parse(mask);
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
		edge: defaultMaskEdgeSettings(),
		adjustments: { light: defaultLightSettings(), color: defaultColorSettings() }
	};
}

export function editDocumentStorageName(photoId: string) {
	return `${photoId}.json`;
}

function maskWithDefaultColor<Mask extends z.infer<typeof versionThreeEditMaskSchema>>(mask: Mask) {
	return { ...mask, adjustments: { ...mask.adjustments, color: defaultColorSettings() } };
}

const versionFourToSixEditDocumentSchema = z.object({
	version: z.union([z.literal(4), z.literal(5), z.literal(6)]),
	photoId: z.string().min(1),
	adjustments: z.object({ light: lightSettingsSchema }),
	geometry: z.object({
		rotation: z.number().finite().min(-180).max(180),
		flipHorizontal: z.boolean(),
		flipVertical: z.boolean(),
		crop: normalizedCropSchema.nullable()
	}),
	masks: z.array(versionSixEditMaskSchema)
});

const versionThreeEditDocumentSchema = z.object({
	version: z.literal(3),
	photoId: z.string().min(1),
	adjustments: z.object({ light: lightSettingsSchema }),
	geometry: z.object({
		rotation: z.number().finite().min(-180).max(180),
		flipHorizontal: z.boolean(),
		flipVertical: z.boolean(),
		crop: normalizedCropSchema.nullable()
	}),
	masks: z.array(versionThreeEditMaskSchema)
});

const versionTwoEditDocumentSchema = z.object({
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
