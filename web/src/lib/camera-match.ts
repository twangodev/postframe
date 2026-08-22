import { z } from 'zod';
import {
	cloneDevelopSettings,
	COLOR_CONTROL_NAMES,
	colorSettingsSchema,
	CURVE_CHANNEL_NAMES,
	curveSettingsSchema,
	LIGHT_CONTROL_NAMES,
	lightSettingsSchema,
	type ColorControlName,
	type CurveChannelName,
	type CurvePoints,
	type DevelopSettings,
	type LightControlName
} from './develop-settings.ts';
import {
	interpolateCurve,
	interpolateScalar,
	type ControlRevealPhase
} from './adjustment-reveal.ts';

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
export type CameraMatchMode = 'none' | 'derive' | 'apply';
export type CameraMatchView = 'baseline' | 'match';

export interface CameraMatchChanges {
	light: LightControlName[];
	color: ColorControlName[];
	curve: CurveChannelName[];
}

export interface CameraMatchCandidate {
	id: number;
	photoId: string;
	target: CameraMatchTarget;
	firstRun: boolean;
	baseline: DevelopSettings;
	automatic: CameraMatchResult;
	draft: CameraMatchResult;
	affected: CameraMatchChanges;
	changes: CameraMatchChanges;
	view: CameraMatchView;
	phase: ControlRevealPhase;
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

export function cameraMatchMode(opening: CameraMatchOpening): CameraMatchMode {
	if (opening === 'prompt') return 'derive';
	if (opening === 'apply') return 'apply';
	return 'none';
}

export function applyCameraMatchSettings(
	current: DevelopSettings,
	matched: CameraMatchSettings
): DevelopSettings {
	return { ...current, light: matched.light, color: matched.color, curve: matched.curve };
}

export function cameraMatchChanges(
	baseline: DevelopSettings,
	matched: CameraMatchSettings
): CameraMatchChanges {
	return {
		light: LIGHT_CONTROL_NAMES.filter(
			(control) => !nearlyEqual(baseline.light[control], matched.light[control])
		),
		color: COLOR_CONTROL_NAMES.filter(
			(control) => !nearlyEqual(baseline.color[control], matched.color[control])
		),
		curve: CURVE_CHANNEL_NAMES.filter(
			(channel) => !sameCurve(baseline.curve[channel], matched.curve[channel])
		)
	};
}

export function interpolateCameraMatchSettings(
	from: DevelopSettings,
	to: DevelopSettings,
	progress: number
): DevelopSettings {
	const settings = cloneDevelopSettings(from);
	for (const control of LIGHT_CONTROL_NAMES) {
		settings.light[control] = interpolateScalar(from.light[control], to.light[control], progress);
	}
	for (const control of COLOR_CONTROL_NAMES) {
		settings.color[control] = interpolateScalar(from.color[control], to.color[control], progress);
	}
	for (const channel of CURVE_CHANNEL_NAMES) {
		settings.curve[channel] = interpolateCurve(from.curve[channel], to.curve[channel], progress);
	}
	return settings;
}

function sameCurve(left: CurvePoints, right: CurvePoints) {
	return (
		left.length === right.length &&
		left.every(
			(point, index) => nearlyEqual(point.x, right[index].x) && nearlyEqual(point.y, right[index].y)
		)
	);
}

function nearlyEqual(left: number, right: number) {
	return Math.abs(left - right) <= 1e-6;
}
