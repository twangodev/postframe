import assert from 'node:assert/strict';
import test from 'node:test';

import {
	adjustmentsIdentity,
	channelCurvesIdentity,
	cloneDevelopSettings,
	colorIdentity,
	curvePointsSchema,
	defaultDetailSettings,
	defaultDevelopSettings,
	detailIdentity,
	effectsIdentity,
	gradingIdentity,
	lightIdentity,
	luminanceIdentity,
	mixerIdentity,
	detailTileKey,
	developSettingsSchema,
	identityCurve,
	defaultMaskAdjustments,
	MASK_GROUP_NAMES,
	maskDevelopSettings,
	neutralMaskAdjustments,
	sameMaskAdjustments,
	withAdjustment,
	withAdjustmentAt,
	withMaskAdjustmentAt,
	withMaskCurve,
	type DevelopSettings,
	type MaskAdjustments,
	type MaskGroupName
} from '../src/lib/develop-settings.ts';

const detailKey = (changed: Partial<ReturnType<typeof defaultDetailSettings>>) =>
	detailTileKey({ ...defaultDetailSettings(), ...changed });

test('the source tile key tracks the tile-side detail work and nothing else', () => {
	assert.equal(detailKey({ dehaze: 60 }), detailKey({}));
	assert.notEqual(detailKey({ noiseLuminance: 30 }), detailKey({}));
	assert.notEqual(detailKey({ noiseColor: 30 }), detailKey({}));
	assert.notEqual(detailKey({ clarity: 10 }), detailKey({}));
});

test('every plane reader shares one key, so dragging clarity reuses the planes', () => {
	assert.equal(detailKey({ clarity: 10 }), detailKey({ clarity: 90 }));
	assert.equal(detailKey({ clarity: 10 }), detailKey({ texture: -80 }));
	assert.equal(detailKey({ clarity: 10 }), detailKey({ sharpenAmount: 150 }));
	assert.equal(detailKey({ clarity: 10, dehaze: -40 }), detailKey({ texture: 5 }));
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

test('mask settings carry every mask group and neutralize detail and effects', () => {
	const light = {
		exposure: 1.25,
		contrast: 20,
		highlights: -35,
		shadows: 15,
		whites: 5,
		blacks: -10
	};
	const color = { temperature: 30, tint: -12, vibrance: 8, saturation: -4 };
	const shaped = {
		...defaultMaskAdjustments(),
		light,
		color,
		curve: {
			...defaultMaskAdjustments().curve,
			red: [
				{ x: 0, y: 0.1 },
				{ x: 1, y: 1 }
			]
		},
		mixer: { ...defaultMaskAdjustments().mixer, aqua: { hue: 20, saturation: -30, luminance: 5 } },
		grading: {
			...defaultMaskAdjustments().grading,
			shadows: { hue: 200, saturation: 40, luminance: -10 }
		}
	};
	const settings = maskDevelopSettings(shaped);
	for (const group of MASK_GROUP_NAMES) assert.deepEqual(settings[group], shaped[group]);
	const neutral = defaultDevelopSettings();
	assert.deepEqual(settings.detail, neutral.detail);
	assert.deepEqual(settings.effects, neutral.effects);
});

test('mask settings detach the supplied groups', () => {
	const adjustments = defaultMaskAdjustments();
	const settings = maskDevelopSettings(adjustments);
	settings.light.exposure = 2;
	settings.curve.luminance[0].y = 0.5;
	settings.mixer.red.hue = 10;
	assert.equal(adjustments.light.exposure, 0);
	assert.equal(adjustments.curve.luminance[0].y, 0);
	assert.equal(adjustments.mixer.red.hue, 0);
});

test('mask adjustments are neutral only when every carried group is at its default', () => {
	assert.equal(neutralMaskAdjustments(defaultMaskAdjustments()), true);
	const moved: Record<MaskGroupName, (adjustments: MaskAdjustments) => void> = {
		light: (adjustments) => (adjustments.light.exposure = 0.1),
		color: (adjustments) => (adjustments.color.tint = 1),
		curve: (adjustments) =>
			(adjustments.curve.blue = [
				{ x: 0, y: 0.05 },
				{ x: 1, y: 1 }
			]),
		mixer: (adjustments) => (adjustments.mixer.orange.saturation = -1),
		grading: (adjustments) => (adjustments.grading.midtones.saturation = 1)
	};
	for (const group of MASK_GROUP_NAMES) {
		const adjustments = defaultMaskAdjustments();
		moved[group](adjustments);
		assert.equal(neutralMaskAdjustments(adjustments), false, `${group} moved but reads neutral`);
	}
});

test('addresses a mask target through the same path as the document', () => {
	const before = defaultMaskAdjustments();
	const after = withMaskAdjustmentAt(
		before,
		{ group: 'mixer', band: 'blue', control: 'saturation' },
		-100
	);
	assert.equal(after.mixer.blue.saturation, -100);
	assert.equal(before.mixer.blue.saturation, 0);
	assert.deepEqual(Object.keys(after), [...MASK_GROUP_NAMES]);
	assert.equal(sameMaskAdjustments(before, after), false);
	assert.equal(
		sameMaskAdjustments(
			after,
			withMaskAdjustmentAt(after, { group: 'mixer', band: 'blue', control: 'saturation' }, -100)
		),
		true
	);
	assert.throws(() => withMaskAdjustmentAt(before, { group: 'light', control: 'exposure' }, 9));

	const shaped = [
		{ x: 0, y: 0 },
		{ x: 0.5, y: 0.7 },
		{ x: 1, y: 1 }
	];
	const curved = withMaskCurve(before, 'green', shaped);
	assert.deepEqual(curved.curve.green, shaped);
	assert.notEqual(curved.curve.green, shaped);
	assert.deepEqual(before.curve.green, identityCurve());
	assert.throws(() => withMaskCurve(before, 'red', [{ x: 0, y: 0 }]));
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

test('every group reads as identity at its defaults, matching the pipeline', () => {
	const neutral = defaultDevelopSettings();
	assert.equal(lightIdentity(neutral.light), true);
	assert.equal(luminanceIdentity(neutral), true);
	assert.equal(channelCurvesIdentity(neutral.curve), true);
	assert.equal(colorIdentity(neutral.color), true);
	assert.equal(mixerIdentity(neutral.mixer), true);
	assert.equal(gradingIdentity(neutral.grading), true);
	assert.equal(detailIdentity(neutral.detail), true);
	assert.equal(effectsIdentity(neutral.effects), true);
	assert.equal(adjustmentsIdentity(neutral), true);
});

test('moving any control leaves identity, so a neutral short-circuit never hides an edit', () => {
	const moved = (mutate: (settings: DevelopSettings) => void) => {
		const settings = defaultDevelopSettings();
		mutate(settings);
		return adjustmentsIdentity(settings);
	};
	const scalarGroups = ['light', 'color', 'detail', 'effects'] as const;
	const gainsOutsideTheToneChain = ['exposure'];
	const runsBeforeTheToneChain = ['noiseLuminance', 'noiseColor'];
	const inertUntilTheirAmountMoves = [
		'vignetteMidpoint',
		'vignetteRoundness',
		'vignetteFeather',
		'grainSize'
	];
	const identityIgnores = new Set([
		...gainsOutsideTheToneChain,
		...runsBeforeTheToneChain,
		...inertUntilTheirAmountMoves
	]);
	const everyControlOf = (group: (typeof scalarGroups)[number]) =>
		Object.keys(defaultDevelopSettings()[group]);
	for (const group of scalarGroups) {
		for (const control of everyControlOf(group)) {
			if (identityIgnores.has(control)) continue;
			assert.equal(
				moved((s) => Object.assign(s[group], { [control]: 1 })),
				false,
				`${group}.${control} moved but the aggregate still reads as identity`
			);
		}
	}
	assert.equal(
		moved(
			(s) =>
				(s.curve.luminance = [
					{ x: 0, y: 0 },
					{ x: 0.5, y: 0.6 },
					{ x: 1, y: 1 }
				])
		),
		false
	);
	assert.equal(
		moved(
			(s) =>
				(s.curve.blue = [
					{ x: 0, y: 0.1 },
					{ x: 1, y: 1 }
				])
		),
		false
	);
	for (const band of Object.keys(defaultDevelopSettings().mixer)) {
		for (const control of ['hue', 'saturation', 'luminance']) {
			assert.equal(
				moved((s) => Object.assign(s.mixer[band as keyof typeof s.mixer], { [control]: 1 })),
				false,
				`mixer.${band}.${control}`
			);
		}
	}
	for (const range of ['shadows', 'midtones', 'highlights'] as const) {
		for (const control of ['saturation', 'luminance']) {
			assert.equal(
				moved((s) => Object.assign(s.grading[range], { [control]: 1 })),
				false,
				`grading.${range}.${control}`
			);
		}
	}
});

test('a control that only shapes another is inert until that one moves', () => {
	const hueOnly = defaultDevelopSettings();
	hueOnly.grading.midtones.hue = 200;
	assert.equal(gradingIdentity(hueOnly.grading), true);

	const shapedVignette = defaultDevelopSettings();
	shapedVignette.effects.vignetteMidpoint = 80;
	shapedVignette.effects.vignetteFeather = 10;
	assert.equal(effectsIdentity(shapedVignette.effects), true);
	shapedVignette.effects.vignetteAmount = -30;
	assert.equal(effectsIdentity(shapedVignette.effects), false);

	const exposureOnly = defaultDevelopSettings();
	exposureOnly.light.exposure = 1.5;
	assert.equal(lightIdentity(exposureOnly.light), true, 'exposure is a gain, not a tone shape');
	assert.equal(adjustmentsIdentity(exposureOnly), true);
});
