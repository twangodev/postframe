import { z } from 'zod';

const signed = z.number().finite().min(-100).max(100);
const unsigned = z.number().finite().min(0).max(100);

export const lightSettingsSchema = z.object({
	exposure: z.number().finite().min(-4).max(4),
	contrast: signed,
	highlights: signed,
	shadows: signed,
	whites: signed,
	blacks: signed
});

export const colorSettingsSchema = z.object({
	temperature: signed,
	tint: signed,
	vibrance: signed,
	saturation: signed
});

export const curvePointSchema = z.object({
	x: z.number().finite().min(0).max(1),
	y: z.number().finite().min(0).max(1)
});

export const curvePointsSchema = z
	.array(curvePointSchema)
	.min(2)
	.refine(
		(points) => points.every((point, index) => index === 0 || point.x > points[index - 1].x),
		{ message: 'curve points must ascend in x' }
	);

export const curveSettingsSchema = z.object({
	luminance: curvePointsSchema,
	red: curvePointsSchema,
	green: curvePointsSchema,
	blue: curvePointsSchema
});

export const mixerBandSchema = z.object({
	hue: signed,
	saturation: signed,
	luminance: signed
});

export const mixerSettingsSchema = z.object({
	red: mixerBandSchema,
	orange: mixerBandSchema,
	yellow: mixerBandSchema,
	green: mixerBandSchema,
	aqua: mixerBandSchema,
	blue: mixerBandSchema,
	purple: mixerBandSchema,
	magenta: mixerBandSchema
});

export const gradingWheelSchema = z.object({
	hue: z.number().finite().min(0).max(360),
	saturation: unsigned,
	luminance: signed
});

export const gradingSettingsSchema = z.object({
	shadows: gradingWheelSchema,
	midtones: gradingWheelSchema,
	highlights: gradingWheelSchema,
	blending: unsigned,
	balance: signed
});

export const detailSettingsSchema = z.object({
	texture: signed,
	clarity: signed,
	dehaze: signed,
	sharpenAmount: z.number().finite().min(0).max(150),
	noiseLuminance: unsigned,
	noiseColor: unsigned
});

export const effectsSettingsSchema = z.object({
	vignetteAmount: signed,
	vignetteMidpoint: unsigned,
	vignetteRoundness: signed,
	vignetteFeather: unsigned,
	grainAmount: unsigned,
	grainSize: unsigned
});

export const developSettingsSchema = z.object({
	light: lightSettingsSchema,
	color: colorSettingsSchema,
	curve: curveSettingsSchema,
	mixer: mixerSettingsSchema,
	grading: gradingSettingsSchema,
	detail: detailSettingsSchema,
	effects: effectsSettingsSchema
});

export type LightSettings = z.infer<typeof lightSettingsSchema>;
export type ColorSettings = z.infer<typeof colorSettingsSchema>;
export type CurvePoint = z.infer<typeof curvePointSchema>;
export type CurvePoints = z.infer<typeof curvePointsSchema>;
export type CurveSettings = z.infer<typeof curveSettingsSchema>;
export type MixerBand = z.infer<typeof mixerBandSchema>;
export type MixerSettings = z.infer<typeof mixerSettingsSchema>;
export type GradingWheel = z.infer<typeof gradingWheelSchema>;
export type GradingSettings = z.infer<typeof gradingSettingsSchema>;
export type DetailSettings = z.infer<typeof detailSettingsSchema>;
export type EffectsSettings = z.infer<typeof effectsSettingsSchema>;
export type DevelopSettings = z.infer<typeof developSettingsSchema>;

export type DevelopGroupName = keyof DevelopSettings;

export type ScalarGroupName = {
	[Group in DevelopGroupName]: DevelopSettings[Group] extends Record<string, number>
		? Group
		: never;
}[DevelopGroupName];

export type ScalarControlName<Group extends ScalarGroupName = ScalarGroupName> = Group extends Group
	? keyof DevelopSettings[Group] & string
	: never;

export type AdjustmentRecord = Record<ScalarControlName, number>;

export const CURVE_CHANNEL_NAMES = [
	'luminance',
	'red',
	'green',
	'blue'
] as const satisfies readonly (keyof CurveSettings)[];

export type CurveChannelName = (typeof CURVE_CHANNEL_NAMES)[number];

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

export const DETAIL_CONTROL_NAMES = [
	'texture',
	'clarity',
	'dehaze',
	'sharpenAmount',
	'noiseLuminance',
	'noiseColor'
] as const satisfies readonly (keyof DetailSettings)[];

export type DetailControlName = (typeof DETAIL_CONTROL_NAMES)[number];

export const EFFECTS_CONTROL_NAMES = [
	'vignetteAmount',
	'vignetteMidpoint',
	'vignetteRoundness',
	'vignetteFeather',
	'grainAmount',
	'grainSize'
] as const satisfies readonly (keyof EffectsSettings)[];

export type EffectsControlName = (typeof EFFECTS_CONTROL_NAMES)[number];

export const MIXER_BAND_NAMES = [
	'red',
	'orange',
	'yellow',
	'green',
	'aqua',
	'blue',
	'purple',
	'magenta'
] as const satisfies readonly (keyof MixerSettings)[];

export type MixerBandName = (typeof MIXER_BAND_NAMES)[number];

export const GRADING_RANGE_NAMES = ['shadows', 'midtones', 'highlights'] as const;

export type GradingRangeName = (typeof GRADING_RANGE_NAMES)[number];

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

export function identityCurve(): CurvePoints {
	return [
		{ x: 0, y: 0 },
		{ x: 1, y: 1 }
	];
}

export function isIdentityCurve(points: CurvePoints) {
	if (points.length !== 2) return false;
	const [first, last] = points;
	return first.x === 0 && first.y === 0 && last.x === 1 && last.y === 1;
}

export function defaultCurveSettings(): CurveSettings {
	return {
		luminance: identityCurve(),
		red: identityCurve(),
		green: identityCurve(),
		blue: identityCurve()
	};
}

export function defaultMixerSettings(): MixerSettings {
	const band = () => ({ hue: 0, saturation: 0, luminance: 0 });
	return {
		red: band(),
		orange: band(),
		yellow: band(),
		green: band(),
		aqua: band(),
		blue: band(),
		purple: band(),
		magenta: band()
	};
}

export function defaultGradingSettings(): GradingSettings {
	const wheel = () => ({ hue: 0, saturation: 0, luminance: 0 });
	return {
		shadows: wheel(),
		midtones: wheel(),
		highlights: wheel(),
		blending: 50,
		balance: 0
	};
}

export function defaultDetailSettings(): DetailSettings {
	return {
		texture: 0,
		clarity: 0,
		dehaze: 0,
		sharpenAmount: 0,
		noiseLuminance: 0,
		noiseColor: 0
	};
}

export function defaultEffectsSettings(): EffectsSettings {
	return {
		vignetteAmount: 0,
		vignetteMidpoint: 50,
		vignetteRoundness: 0,
		vignetteFeather: 50,
		grainAmount: 0,
		grainSize: 25
	};
}

export function defaultDevelopSettings(): DevelopSettings {
	return {
		light: defaultLightSettings(),
		color: defaultColorSettings(),
		curve: defaultCurveSettings(),
		mixer: defaultMixerSettings(),
		grading: defaultGradingSettings(),
		detail: defaultDetailSettings(),
		effects: defaultEffectsSettings()
	};
}

export function tonalDevelopSettings(light: LightSettings, color: ColorSettings): DevelopSettings {
	return { ...defaultDevelopSettings(), light: { ...light }, color: { ...color } };
}

export function cloneDevelopSettings(settings: DevelopSettings): DevelopSettings {
	return developSettingsSchema.parse(settings);
}

export function cloneCurveSettings(curve: CurveSettings): CurveSettings {
	return curveSettingsSchema.parse(curve);
}

export function scalarAdjustments(settings: DevelopSettings): AdjustmentRecord {
	return { ...settings.light, ...settings.color, ...settings.detail, ...settings.effects };
}

export function withAdjustment<Group extends ScalarGroupName>(
	settings: DevelopSettings,
	group: Group,
	control: ScalarControlName<Group>,
	value: number
): DevelopSettings {
	const next = cloneDevelopSettings(settings);
	Object.assign(next[group], { [control]: value });
	return next;
}

export function withCurve(
	settings: DevelopSettings,
	channel: CurveChannelName,
	points: CurvePoints
): DevelopSettings {
	const next = cloneDevelopSettings(settings);
	next.curve[channel] = curvePointsSchema.parse(points);
	return next;
}

export function developSettingsKey(settings: DevelopSettings) {
	return canonicalKey(settings);
}

export function sameDevelopSettings(left: DevelopSettings, right: DevelopSettings) {
	return developSettingsKey(left) === developSettingsKey(right);
}

function canonicalKey(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalKey)}]`;
	if (typeof value !== 'object' || value === null) return String(value);
	return `{${Object.entries(value)
		.sort(([left], [right]) => (left < right ? -1 : 1))
		.map(([key, nested]) => `${key}:${canonicalKey(nested)}`)}}`;
}
