import { z } from 'zod';

export const maskEdgeSettingsSchema = z.object({
	contrast: z.number().finite().min(0).max(100),
	feather: z.number().finite().min(0).max(100),
	shift: z.number().finite().min(-100).max(100)
});

export type MaskEdgeSettings = z.infer<typeof maskEdgeSettingsSchema>;
export type MaskEdgeControlName = keyof MaskEdgeSettings;

export function defaultMaskEdgeSettings(): MaskEdgeSettings {
	return { contrast: 0, feather: 0, shift: 0 };
}

export function isNeutralMaskEdge({ contrast, feather, shift }: MaskEdgeSettings): boolean {
	return contrast === 0 && feather === 0 && shift === 0;
}
