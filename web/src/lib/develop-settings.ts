import { z } from 'zod';

export const DEVELOP_SETTINGS_VERSION = 1;

export const developSettingsSchema = z.object({
	version: z.literal(DEVELOP_SETTINGS_VERSION),
	exposure: z.number().finite().min(-4).max(4)
});

export type DevelopSettings = z.infer<typeof developSettingsSchema>;

export function defaultDevelopSettings(): DevelopSettings {
	return { version: DEVELOP_SETTINGS_VERSION, exposure: 0 };
}

export function developStorageName(photoId: string) {
	return `${photoId}.json`;
}
