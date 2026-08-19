import assert from 'node:assert/strict';
import test from 'node:test';

import {
	adjustmentSuffix,
	COLOR_SLIDERS,
	DETAIL_SLIDERS,
	EFFECTS_SLIDERS,
	GRADING_BLEND_SLIDERS,
	LIGHT_SLIDERS,
	MASK_EDGE_SLIDERS,
	PRESENCE_SLIDERS,
	type SliderSpec
} from '../src/lib/develop-sliders.ts';

const tables: Record<string, readonly SliderSpec[]> = {
	LIGHT_SLIDERS,
	COLOR_SLIDERS,
	PRESENCE_SLIDERS,
	DETAIL_SLIDERS,
	EFFECTS_SLIDERS,
	MASK_EDGE_SLIDERS,
	GRADING_BLEND_SLIDERS
};

const labels = (specs: readonly SliderSpec[]) => specs.map(({ label }) => label);

test('the tables keep every slider label verbatim', () => {
	assert.deepEqual(labels(LIGHT_SLIDERS), [
		'Exposure',
		'Contrast',
		'Highlights',
		'Shadows',
		'Whites',
		'Blacks'
	]);
	assert.deepEqual(labels(COLOR_SLIDERS), ['Temperature', 'Tint', 'Vibrance', 'Saturation']);
	assert.deepEqual(labels(PRESENCE_SLIDERS), ['Texture', 'Clarity', 'Dehaze']);
	assert.deepEqual(labels(DETAIL_SLIDERS), ['Sharpening', 'Noise reduction', 'Color noise']);
	assert.deepEqual(labels(EFFECTS_SLIDERS), [
		'Vignette',
		'Midpoint',
		'Roundness',
		'Feather',
		'Grain',
		'Grain size'
	]);
	assert.deepEqual(labels(MASK_EDGE_SLIDERS), ['Definition', 'Feather', 'Shift']);
	assert.deepEqual(labels(GRADING_BLEND_SLIDERS), ['blending', 'balance']);
});

test('exposure keeps its fine-grained EV shape', () => {
	const exposure = LIGHT_SLIDERS.find(({ control }) => control === 'exposure');
	assert.deepEqual(exposure, {
		control: 'exposure',
		label: 'Exposure',
		min: -4,
		max: 4,
		step: 0.05,
		decimals: 2,
		suffix: ' EV',
		signed: true,
		defaultValue: 0
	});
});

test('defaults come from the develop and mask-edge defaults, not the table', () => {
	const byControl = (specs: readonly SliderSpec[], control: string) =>
		specs.find((spec) => spec.control === control)!;
	assert.equal(byControl(EFFECTS_SLIDERS, 'vignetteMidpoint').defaultValue, 50);
	assert.equal(byControl(EFFECTS_SLIDERS, 'vignetteFeather').defaultValue, 50);
	assert.equal(byControl(EFFECTS_SLIDERS, 'grainSize').defaultValue, 25);
	assert.equal(byControl(GRADING_BLEND_SLIDERS, 'blending').defaultValue, 50);
	assert.equal(byControl(GRADING_BLEND_SLIDERS, 'balance').defaultValue, 0);
	for (const spec of [...LIGHT_SLIDERS, ...COLOR_SLIDERS, ...MASK_EDGE_SLIDERS]) {
		assert.equal(spec.defaultValue, 0, `${spec.control} defaults to 0`);
	}
});

test('sliders spanning zero are signed and unsigned ones are not', () => {
	for (const [name, specs] of Object.entries(tables)) {
		for (const spec of specs) {
			assert.equal(spec.signed, spec.min < 0, `${name} ${spec.control}`);
		}
	}
});

test('pixel and degree suffixes survive on the mask edge sliders', () => {
	assert.deepEqual(
		MASK_EDGE_SLIDERS.map(({ suffix }) => suffix),
		[undefined, ' px', ' px']
	);
});

test('adjustmentSuffix resolves history-label suffixes from the tables', () => {
	assert.equal(adjustmentSuffix('exposure'), ' EV');
	assert.equal(adjustmentSuffix('feather'), ' px');
	assert.equal(adjustmentSuffix('shift'), ' px');
	assert.equal(adjustmentSuffix('contrast'), '');
	assert.equal(adjustmentSuffix('shadows hue'), '');
});
