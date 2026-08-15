import { z } from 'zod';

export const DEVELOP_SETTINGS_VERSION = 1;

export const lightSettingsSchema = z.object({
	exposure: z.number().finite().min(-4).max(4),
	contrast: z.number().finite().min(-100).max(100),
	highlights: z.number().finite().min(-100).max(100),
	shadows: z.number().finite().min(-100).max(100),
	whites: z.number().finite().min(-100).max(100),
	blacks: z.number().finite().min(-100).max(100)
});

export const colorSettingsSchema = z.object({
	temperature: z.number().finite().min(-100).max(100),
	tint: z.number().finite().min(-100).max(100),
	vibrance: z.number().finite().min(-100).max(100),
	saturation: z.number().finite().min(-100).max(100)
});

export const developSettingsSchema = lightSettingsSchema.extend({
	version: z.literal(DEVELOP_SETTINGS_VERSION)
});

export type DevelopSettings = z.infer<typeof developSettingsSchema>;
export type LightSettings = z.infer<typeof lightSettingsSchema>;
export type ColorSettings = z.infer<typeof colorSettingsSchema>;

export const LIGHT_CONTROL_NAMES = [
	'exposure',
	'contrast',
	'highlights',
	'shadows',
	'whites',
	'blacks'
] as const satisfies readonly (keyof LightSettings)[];

export type LightControlName = (typeof LIGHT_CONTROL_NAMES)[number];

export const COLOR_CONTROL_NAMES = [
	'temperature',
	'tint',
	'vibrance',
	'saturation'
] as const satisfies readonly (keyof ColorSettings)[];

export type ColorControlName = (typeof COLOR_CONTROL_NAMES)[number];

export function defaultLightSettings(): LightSettings {
	return {
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0
	};
}

export function defaultColorSettings(): ColorSettings {
	return { temperature: 0, tint: 0, vibrance: 0, saturation: 0 };
}

export function defaultDevelopSettings(): DevelopSettings {
	return { version: DEVELOP_SETTINGS_VERSION, ...defaultLightSettings() };
}

export function lightSettings(settings: DevelopSettings): LightSettings {
	return Object.fromEntries(
		LIGHT_CONTROL_NAMES.map((name) => [name, settings[name]])
	) as LightSettings;
}
