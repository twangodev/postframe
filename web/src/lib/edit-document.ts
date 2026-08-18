import { z } from 'zod';
import {
	defaultDevelopSettings,
	defaultLightSettings,
	defaultMaskAdjustments,
	developSettingsSchema,
	lightSettingsSchema,
	maskAdjustmentsSchema,
	type LightSettings
} from './develop-settings.ts';
import { defaultMaskEdgeSettings, maskEdgeSettingsSchema } from './mask-edge-settings.ts';

export const EDIT_DOCUMENT_VERSION = 11;

export const maskKindSchema = z.enum([
	'brush',
	'linear',
	'radial',
	'object',
	'subject',
	'sky',
	'background',
	'luminance',
	'color'
]);
export const maskOperationSchema = z.enum(['add', 'subtract', 'intersect']);
export const maskPromptLabelSchema = z.enum(['foreground', 'background']);

const unit = z.number().finite().min(0).max(1);

export const normalizedPointSchema = z.object({
	x: unit,
	y: unit
});

export const luminanceRangeSchema = z
	.object({ low: unit, high: unit, feather: unit })
	.refine(({ low, high }) => low <= high, { message: 'luminance range low exceeds its high' });

export const colorRangeSchema = z.object({
	hue: z.number().finite().min(0).max(360),
	width: z.number().finite().min(0).max(90),
	saturationFloor: unit,
	feather: unit
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
		anchor: normalizedPointSchema,
		rotation: z.number().finite(),
		compression: z.number().finite().positive().max(1)
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('radial'),
		center: normalizedPointSchema,
		radiusX: z.number().finite().positive().max(1),
		radiusY: z.number().finite().positive().max(1),
		rotation: z.number().finite(),
		feather: z.number().finite().min(0).max(1)
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('luminance-range'),
		range: luminanceRangeSchema
	}),
	maskComponentBaseSchema.extend({
		type: z.literal('color-range'),
		range: colorRangeSchema
	})
]);

export const editMaskSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1),
	kind: maskKindSchema,
	visible: z.boolean(),
	components: z.array(maskComponentSchema),
	edge: maskEdgeSettingsSchema,
	adjustments: maskAdjustmentsSchema
});

export const editDocumentSchema = z
	.object({
		version: z.literal(EDIT_DOCUMENT_VERSION),
		photoId: z.string().min(1),
		adjustments: developSettingsSchema,
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
export type LuminanceRange = z.infer<typeof luminanceRangeSchema>;
export type ColorRange = z.infer<typeof colorRangeSchema>;
export type LuminanceRangeComponent = Extract<MaskComponent, { type: 'luminance-range' }>;
export type ColorRangeComponent = Extract<MaskComponent, { type: 'color-range' }>;
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
		adjustments: { ...defaultDevelopSettings(), light: lightSettingsSchema.parse(light) },
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
	const document = editDocumentSchema.parse(value);
	if (document.photoId !== photoId) throw new Error(`Edit document belongs to another photo`);
	return document;
}

export function cloneEditDocument(document: EditDocument): EditDocument {
	return editDocumentSchema.parse(document);
}

export function cloneCrop(crop: NormalizedCrop | null): NormalizedCrop | null {
	return crop ? { ...crop } : null;
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
		background: 'background',
		luminance: 'Luminance range',
		color: 'Colour range'
	};
	return {
		id,
		name: names[kind],
		kind,
		visible: true,
		components: [],
		edge: defaultMaskEdgeSettings(),
		adjustments: defaultMaskAdjustments()
	};
}

export function defaultLuminanceRange(): LuminanceRange {
	return { low: 0.5, high: 1, feather: 0.1 };
}

export function defaultColorRange(): ColorRange {
	return { hue: 210, width: 30, saturationFloor: 0.2, feather: 0.25 };
}

export function editDocumentStorageName(photoId: string) {
	return `${photoId}.json`;
}
