import { z } from 'zod';

export const DEVELOP_SETTINGS_VERSION = 1;

export const developSettingsSchema = z.object({
	version: z.literal(DEVELOP_SETTINGS_VERSION),
	exposure: z.number().finite().min(-4).max(4),
	contrast: z.number().finite().min(-100).max(100),
	highlights: z.number().finite().min(-100).max(100),
	shadows: z.number().finite().min(-100).max(100),
	whites: z.number().finite().min(-100).max(100),
	blacks: z.number().finite().min(-100).max(100)
});

export type DevelopSettings = z.infer<typeof developSettingsSchema>;
export type LightSettings = Omit<DevelopSettings, 'version'>;

export const LIGHT_CONTROL_NAMES = [
	'exposure',
	'contrast',
	'highlights',
	'shadows',
	'whites',
	'blacks'
] as const satisfies readonly (keyof LightSettings)[];

export type LightControlName = (typeof LIGHT_CONTROL_NAMES)[number];

export function defaultDevelopSettings(): DevelopSettings {
	return {
		version: DEVELOP_SETTINGS_VERSION,
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0
	};
}

export function lightSettings(settings: DevelopSettings): LightSettings {
	return Object.fromEntries(
		LIGHT_CONTROL_NAMES.map((name) => [name, settings[name]])
	) as LightSettings;
}

export function developStorageName(photoId: string) {
	return `${photoId}.json`;
}
