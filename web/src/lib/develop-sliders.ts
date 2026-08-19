import {
	defaultDevelopSettings,
	type ColorControlName,
	type DetailControlName,
	type EffectsControlName,
	type GradingBlendControlName,
	type LightControlName
} from './develop-settings.ts';
import { defaultMaskEdgeSettings, type MaskEdgeControlName } from './mask-edge-settings.ts';

/// One scalar slider, ready to spread onto AdjustmentSlider; signedness follows the range.
export interface SliderSpec<Control extends string = string> {
	readonly control: Control;
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly step?: number;
	readonly decimals?: number;
	readonly suffix?: string;
	readonly signed: boolean;
	readonly defaultValue: number;
}

type SliderShape<Control extends string> = Omit<SliderSpec<Control>, 'signed' | 'defaultValue'>;

function sliders<Control extends string>(
	defaults: Record<Control, number>,
	shapes: readonly SliderShape<Control>[]
): readonly SliderSpec<Control>[] {
	return shapes.map((shape) => ({
		...shape,
		signed: shape.min < 0,
		defaultValue: defaults[shape.control]
	}));
}

const settings = defaultDevelopSettings();

export const LIGHT_SLIDERS: readonly SliderSpec<LightControlName>[] = sliders(settings.light, [
	{
		control: 'exposure',
		label: 'Exposure',
		min: -4,
		max: 4,
		step: 0.05,
		decimals: 2,
		suffix: ' EV'
	},
	{ control: 'contrast', label: 'Contrast', min: -100, max: 100 },
	{ control: 'highlights', label: 'Highlights', min: -100, max: 100 },
	{ control: 'shadows', label: 'Shadows', min: -100, max: 100 },
	{ control: 'whites', label: 'Whites', min: -100, max: 100 },
	{ control: 'blacks', label: 'Blacks', min: -100, max: 100 }
]);

export const COLOR_SLIDERS: readonly SliderSpec<ColorControlName>[] = sliders(settings.color, [
	{ control: 'temperature', label: 'Temperature', min: -100, max: 100 },
	{ control: 'tint', label: 'Tint', min: -100, max: 100 },
	{ control: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
	{ control: 'saturation', label: 'Saturation', min: -100, max: 100 }
]);

export const PRESENCE_SLIDERS: readonly SliderSpec<DetailControlName>[] = sliders(settings.detail, [
	{ control: 'texture', label: 'Texture', min: -100, max: 100 },
	{ control: 'clarity', label: 'Clarity', min: -100, max: 100 },
	{ control: 'dehaze', label: 'Dehaze', min: -100, max: 100 }
]);

export const DETAIL_SLIDERS: readonly SliderSpec<DetailControlName>[] = sliders(settings.detail, [
	{ control: 'sharpenAmount', label: 'Sharpening', min: 0, max: 150 },
	{ control: 'noiseLuminance', label: 'Noise reduction', min: 0, max: 100 },
	{ control: 'noiseColor', label: 'Color noise', min: 0, max: 100 }
]);

export const EFFECTS_SLIDERS: readonly SliderSpec<EffectsControlName>[] = sliders(
	settings.effects,
	[
		{ control: 'vignetteAmount', label: 'Vignette', min: -100, max: 100 },
		{ control: 'vignetteMidpoint', label: 'Midpoint', min: 0, max: 100 },
		{ control: 'vignetteRoundness', label: 'Roundness', min: -100, max: 100 },
		{ control: 'vignetteFeather', label: 'Feather', min: 0, max: 100 },
		{ control: 'grainAmount', label: 'Grain', min: 0, max: 100 },
		{ control: 'grainSize', label: 'Grain size', min: 0, max: 100 }
	]
);

export const MASK_EDGE_SLIDERS: readonly SliderSpec<MaskEdgeControlName>[] = sliders(
	defaultMaskEdgeSettings(),
	[
		{ control: 'contrast', label: 'Definition', min: 0, max: 100 },
		{ control: 'feather', label: 'Feather', min: 0, max: 100, suffix: ' px' },
		{ control: 'shift', label: 'Shift', min: -100, max: 100, suffix: ' px' }
	]
);

export const GRADING_BLEND_SLIDERS: readonly SliderSpec<GradingBlendControlName>[] = sliders(
	settings.grading,
	[
		{ control: 'blending', label: 'blending', min: 0, max: 100 },
		{ control: 'balance', label: 'balance', min: -100, max: 100 }
	]
);

const SUFFIXES = new Map<string, string>(
	[
		...LIGHT_SLIDERS,
		...COLOR_SLIDERS,
		...PRESENCE_SLIDERS,
		...DETAIL_SLIDERS,
		...EFFECTS_SLIDERS,
		...MASK_EDGE_SLIDERS,
		...GRADING_BLEND_SLIDERS
	].flatMap((spec) => (spec.suffix ? [[spec.control, spec.suffix] as const] : []))
);

export function adjustmentSuffix(control: string): string {
	return SUFFIXES.get(control) ?? '';
}
