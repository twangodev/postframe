import assert from 'node:assert/strict';
import test from 'node:test';

import {
	curvePointsSchema,
	defaultDetailSettings,
	defaultDevelopSettings,
	cloneDevelopSettings,
	detailTileKey,
	developSettingsSchema,
	identityCurve,
	tonalDevelopSettings,
	withAdjustment,
	withAdjustmentAt
} from '../src/lib/develop-settings.ts';

test('the source tile key tracks the tile-side detail work and nothing else', () => {
	const neutral = defaultDetailSettings();
	const key = (changed: Partial<typeof neutral>) => detailTileKey({ ...neutral, ...changed });

	assert.equal(key({ dehaze: 60 }), key({}));
	assert.notEqual(key({ noiseLuminance: 30 }), key({}));
	assert.notEqual(key({ noiseColor: 30 }), key({}));
	assert.notEqual(key({ clarity: 10 }), key({}));

	// Every plane reader shares one key, so dragging clarity reuses the planes.
	assert.equal(key({ clarity: 10 }), key({ clarity: 90 }));
	assert.equal(key({ clarity: 10 }), key({ texture: -80 }));
	assert.equal(key({ clarity: 10 }), key({ sharpenAmount: 150 }));
	assert.equal(key({ clarity: 10, dehaze: -40 }), key({ texture: 5 }));
});

test('the neutral develop aggregate satisfies its own schema', () => {
	const settings = defaultDevelopSettings();
	assert.deepEqual(developSettingsSchema.parse(settings), settings);
});

test('rejects an aggregate missing a develop group', () => {
	const { curve: _curve, ...withoutCurve } = defaultDevelopSettings();
	assert.equal(developSettingsSchema.safeParse(withoutCurve).success, false);
});

test('rejects curves whose points do not ascend in x', () => {
	assert.equal(
		curvePointsSchema.safeParse([
			{ x: 0.6, y: 0.6 },
			{ x: 0.2, y: 0.2 }
		]).success,
		false
	);
	assert.equal(
		curvePointsSchema.safeParse([
			{ x: 0.5, y: 0.1 },
			{ x: 0.5, y: 0.9 }
		]).success,
		false
	);
});

test('rejects curves with fewer than two points', () => {
	assert.equal(curvePointsSchema.safeParse([{ x: 0, y: 0 }]).success, false);
	assert.equal(curvePointsSchema.safeParse([]).success, false);
	assert.deepEqual(curvePointsSchema.parse(identityCurve()), identityCurve());
});

test('widening tonal settings keeps light and colour and neutralizes the rest', () => {
	const light = {
		exposure: 1.25,
		contrast: 20,
		highlights: -35,
		shadows: 15,
		whites: 5,
		blacks: -10
	};
	const color = { temperature: 30, tint: -12, vibrance: 8, saturation: -4 };
	const settings = tonalDevelopSettings(light, color);
	assert.deepEqual(settings.light, light);
	assert.deepEqual(settings.color, color);
	const neutral = defaultDevelopSettings();
	assert.deepEqual(settings.curve, neutral.curve);
	assert.deepEqual(settings.mixer, neutral.mixer);
	assert.deepEqual(settings.grading, neutral.grading);
	assert.deepEqual(settings.detail, neutral.detail);
	assert.deepEqual(settings.effects, neutral.effects);
});

test('widening tonal settings detaches the supplied groups', () => {
	const light = {
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0
	};
	const settings = tonalDevelopSettings(light, {
		temperature: 0,
		tint: 0,
		vibrance: 0,
		saturation: 0
	});
	settings.light.exposure = 2;
	assert.equal(light.exposure, 0);
});

test('clones settings held behind a reactive proxy', () => {
	const settings = defaultDevelopSettings();
	const reactive = new Proxy(settings, {});
	const cloned = cloneDevelopSettings(reactive);

	assert.deepEqual(cloned, settings);
	cloned.light.exposure = 2;
	cloned.curve.luminance[0].y = 0.5;
	assert.equal(settings.light.exposure, 0);
	assert.equal(settings.curve.luminance[0].y, 0);
});

test('addresses a mixer band without disturbing its neighbours', () => {
	const before = defaultDevelopSettings();
	const after = withAdjustmentAt(before, { group: 'mixer', band: 'aqua', control: 'hue' }, -40);

	assert.equal(after.mixer.aqua.hue, -40);
	assert.equal(after.mixer.aqua.saturation, 0);
	assert.deepEqual(after.mixer.blue, before.mixer.blue);
	assert.equal(before.mixer.aqua.hue, 0);
});

test('addresses a grading range and its shared sliders', () => {
	const before = defaultDevelopSettings();
	const tinted = withAdjustmentAt(
		before,
		{ group: 'grading', range: 'highlights', control: 'saturation' },
		65
	);
	assert.equal(tinted.grading.highlights.saturation, 65);
	assert.deepEqual(tinted.grading.shadows, before.grading.shadows);

	const balanced = withAdjustmentAt(tinted, { group: 'grading', control: 'balance' }, -20);
	assert.equal(balanced.grading.balance, -20);
	assert.equal(balanced.grading.highlights.saturation, 65);
	assert.equal(before.grading.balance, 0);
});

test('addresses a flat group the same way as the scalar helper', () => {
	const before = defaultDevelopSettings();
	assert.deepEqual(
		withAdjustmentAt(before, { group: 'color', control: 'vibrance' }, 30),
		withAdjustment(before, 'color', 'vibrance', 30)
	);
});
