import { z } from 'zod';
import {
	colorSettingsSchema,
	curveSettingsSchema,
	lightSettingsSchema,
	type DevelopSettings
} from './develop-settings.ts';

export const cameraMatchSettingsSchema = z.object({
	light: lightSettingsSchema,
	color: colorSettingsSchema,
	curve: curveSettingsSchema
});

export const cameraMatchResultSchema = cameraMatchSettingsSchema.extend({
	cameraLook: z.number().finite().min(0).max(100),
	meanError: z.number().finite().nonnegative(),
	p99Error: z.number().finite().nonnegative(),
	settingsOnlyError: z.number().finite().nonnegative(),
	fitError: z.number().finite().nonnegative()
});

export const cameraMatchTargetSchema = z.enum(['camera-jpeg', 'embedded-preview']);
export const cameraMatchPreferenceSchema = z.enum(['ask', 'always', 'never']);

export type CameraMatchSettings = z.infer<typeof cameraMatchSettingsSchema>;
export type CameraMatchResult = z.infer<typeof cameraMatchResultSchema>;
export type CameraMatchTarget = z.infer<typeof cameraMatchTargetSchema>;
export type CameraMatchPreference = z.infer<typeof cameraMatchPreferenceSchema>;

export interface CameraMatchCandidate {
	id: number;
	photoId: string;
	target: CameraMatchTarget;
	automatic: CameraMatchResult;
	draft: CameraMatchResult;
}

export type CameraMatchOpening = 'unchanged' | 'prompt' | 'apply' | 'neutral';

export function cameraMatchOpening(
	status: 'legacy' | 'pending' | 'dismissed' | 'applied',
	preference: CameraMatchPreference
): CameraMatchOpening {
	if (status !== 'pending') return 'unchanged';
	if (preference === 'always') return 'apply';
	if (preference === 'never') return 'neutral';
	return 'prompt';
}

export function applyCameraMatchSettings(
	current: DevelopSettings,
	matched: CameraMatchSettings
): DevelopSettings {
	return { ...current, light: matched.light, color: matched.color, curve: matched.curve };
}
