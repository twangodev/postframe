import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEVELOP_GROUP_NAMES,
	MASK_GROUP_NAMES,
	defaultGradingSettings,
	defaultMixerSettings,
	identityCurve
} from '../src/lib/develop-settings.ts';
import {
	EDIT_DOCUMENT_VERSION,
	cloneEditDocument,
	createEditMask,
	defaultColorRange,
	defaultEditDocument,
	defaultLuminanceRange,
	editDocumentStorageName,
	editDocumentSchema,
	editMaskSchema,
	maskKindSchema,
	parseEditDocument
} from '../src/lib/edit-document.ts';

test('creates an independent versioned non-destructive document', () => {
	const first = defaultEditDocument('photo-one');
	const second = defaultEditDocument('photo-one');
	assert.equal(first.version, EDIT_DOCUMENT_VERSION);
	assert.equal(first.photoId, 'photo-one');
	assert.deepEqual(first.geometry, {
		rotation: 0,
		flipHorizontal: false,
		flipVertical: false,
		crop: null
	});
	assert.notEqual(first, second);
	assert.notEqual(first.adjustments.light, second.adjustments.light);
	assert.equal(editDocumentStorageName('photo-one'), 'photo-one.json');
});

test('rejects mismatched photos, duplicate masks, and invalid normalized crops', () => {
	const document = defaultEditDocument('photo-one');
	assert.throws(() => parseEditDocument({ ...document, photoId: 'photo-two' }, 'photo-one'));
	const mask = createEditMask('mask-one', 'brush');
	assert.deepEqual(mask.components, []);
	assert.equal(editDocumentSchema.safeParse({ ...document, masks: [mask, mask] }).success, false);
	assert.equal(
		editDocumentSchema.safeParse({
			...document,
			geometry: { ...document.geometry, crop: { x: 0.75, y: 0, width: 0.5, height: 1 } }
		}).success,
		false
	);
	const object = createEditMask('object-one', 'object');
	object.components.push({
		id: 'component-one',
		type: 'ai-object',
		operation: 'add',
		modelVersion: 'model-one',
		alternatives: { index: 2, count: 2 },
		prompts: [{ label: 'foreground', points: [{ x: 0.5, y: 0.5 }] }],
		raster: null
	});
	assert.equal(editDocumentSchema.safeParse({ ...document, masks: [object] }).success, false);
});

test('round-trips a document carrying every develop group', () => {
	const document = defaultEditDocument('photo-one');
	document.adjustments = {
		light: { exposure: 0.5, contrast: 10, highlights: -20, shadows: 30, whites: 5, blacks: -5 },
		color: { temperature: 25, tint: -10, vibrance: 15, saturation: -8 },
		curve: {
			luminance: [
				{ x: 0, y: 0.05 },
				{ x: 0.5, y: 0.6 },
				{ x: 1, y: 1 }
			],
			red: identityCurve(),
			green: identityCurve(),
			blue: identityCurve()
		},
		mixer: { ...defaultMixerSettings(), aqua: { hue: -12, saturation: 40, luminance: 7 } },
		grading: {
			...defaultGradingSettings(),
			midtones: { hue: 210, saturation: 35, luminance: -6 },
			balance: 18
		},
		detail: {
			texture: 12,
			clarity: -4,
			dehaze: 20,
			sharpenAmount: 90,
			noiseLuminance: 30,
			noiseColor: 15
		},
		effects: {
			vignetteAmount: -40,
			vignetteMidpoint: 60,
			vignetteRoundness: 25,
			vignetteFeather: 70,
			grainAmount: 20,
			grainSize: 35
		}
	};
	assert.equal(document.version, 11);
	assert.deepEqual(editDocumentSchema.parse(document), document);
	assert.deepEqual(cloneEditDocument(document).adjustments, document.adjustments);
	assert.notEqual(
		cloneEditDocument(document).adjustments.curve.luminance,
		document.adjustments.curve.luminance
	);
});

test('masks carry every group but detail and effects, and round-trip them', () => {
	const mask = createEditMask('mask-one', 'brush');
	assert.deepEqual(Object.keys(mask.adjustments), [...MASK_GROUP_NAMES]);
	assert.deepEqual(Object.keys(defaultEditDocument('photo-one').adjustments), [
		...DEVELOP_GROUP_NAMES
	]);
	mask.adjustments.curve.red = [
		{ x: 0, y: 0.2 },
		{ x: 0.5, y: 0.5 },
		{ x: 1, y: 1 }
	];
	mask.adjustments.mixer.aqua.hue = 33;
	mask.adjustments.grading.highlights = { hue: 45, saturation: 60, luminance: 10 };
	const document = { ...defaultEditDocument('photo-one'), masks: [mask] };
	const cloned = cloneEditDocument(document);
	assert.deepEqual(cloned, document);
	assert.notEqual(cloned.masks[0]?.adjustments.curve.red, mask.adjustments.curve.red);
	assert.notEqual(cloned.masks[0]?.adjustments.mixer, mask.adjustments.mixer);
});

test('rejects current documents whose masks lack a mask group', () => {
	for (const group of MASK_GROUP_NAMES) {
		const mask = createEditMask('mask-one', 'radial');
		const { [group]: _dropped, ...adjustments } = mask.adjustments;
		const document = { ...defaultEditDocument('photo-one'), masks: [{ ...mask, adjustments }] };
		assert.equal(editDocumentSchema.safeParse(document).success, false, `${group} was optional`);
	}
});

test('rejects current documents lacking global color adjustments', () => {
	const document = defaultEditDocument('photo-one');
	assert.equal(
		editDocumentSchema.safeParse({
			...document,
			adjustments: { light: document.adjustments.light }
		}).success,
		false
	);
});

test('accepts gradient components carrying their transform', () => {
	const linear = createEditMask('mask-linear', 'linear');
	linear.components.push({
		id: 'component-linear',
		type: 'linear',
		operation: 'add',
		raster: null,
		anchor: { x: 0.5, y: 0.5 },
		rotation: 0.4,
		compression: 0.25
	});
	const radial = createEditMask('mask-radial', 'radial');
	radial.components.push({
		id: 'component-radial',
		type: 'radial',
		operation: 'add',
		raster: null,
		center: { x: 0.5, y: 0.5 },
		radiusX: 0.3,
		radiusY: 0.2,
		rotation: 0.1,
		feather: 0.5
	});
	const document = { ...defaultEditDocument('photo-one'), masks: [linear, radial] };
	assert.deepEqual(parseEditDocument(document, 'photo-one').masks, [linear, radial]);
	assert.equal(
		editMaskSchema.safeParse({
			...radial,
			components: [{ ...radial.components[0], radiusX: 1.5 }]
		}).success,
		false
	);
});

test('accepts range components and names their masks', () => {
	const luminance = createEditMask('mask-luminance', 'luminance');
	assert.equal(luminance.name, 'Luminance range');
	luminance.components.push({
		id: 'component-luminance',
		type: 'luminance-range',
		operation: 'add',
		raster: null,
		range: defaultLuminanceRange()
	});
	const color = createEditMask('mask-color', 'color');
	assert.equal(color.name, 'Colour range');
	color.components.push({
		id: 'component-color',
		type: 'color-range',
		operation: 'intersect',
		raster: {
			storageName: 'component-color.bin',
			width: 8,
			height: 4,
			digest: 'b'.repeat(64)
		},
		range: defaultColorRange()
	});
	const document = { ...defaultEditDocument('photo-one'), masks: [luminance, color] };
	assert.deepEqual(parseEditDocument(document, 'photo-one').masks, [luminance, color]);
	assert.deepEqual(defaultLuminanceRange(), { low: 0.5, high: 1, feather: 0.1 });
	assert.deepEqual(defaultColorRange(), {
		hue: 210,
		width: 30,
		saturationFloor: 0.2,
		feather: 0.25
	});
	assert.equal(
		editMaskSchema.safeParse({
			...luminance,
			components: [{ ...luminance.components[0], range: { low: 0.8, high: 0.2, feather: 0.1 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...luminance,
			components: [{ ...luminance.components[0], range: { low: 0.2, high: 1.2, feather: 0.1 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...color,
			components: [{ ...color.components[0], range: { ...defaultColorRange(), hue: 400 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...color,
			components: [{ ...color.components[0], range: { ...defaultColorRange(), width: 95 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...color,
			components: [
				{ ...color.components[0], range: { ...defaultColorRange(), saturationFloor: -0.1 } }
			]
		}).success,
		false
	);
});

test('every mask kind creates a named mask', () => {
	for (const kind of maskKindSchema.options) {
		const mask = createEditMask(`mask-${kind}`, kind);
		assert.equal(mask.kind, kind);
		assert.ok(mask.name.length > 0);
		assert.equal(editMaskSchema.safeParse(mask).success, true);
	}
	assert.ok(maskKindSchema.options.includes('luminance'));
	assert.ok(maskKindSchema.options.includes('color'));
});

test('rejects documents from earlier schema versions outright', () => {
	assert.throws(() =>
		parseEditDocument({ ...defaultEditDocument('photo-one'), version: 8 }, 'photo-one')
	);
	const legacyLinear = {
		...defaultEditDocument('photo-one'),
		masks: [
			{
				...createEditMask('mask-linear', 'linear'),
				components: [
					{
						id: 'component-linear',
						type: 'linear',
						operation: 'add',
						raster: null,
						start: { x: 0.25, y: 0.5 },
						end: { x: 0.75, y: 0.5 }
					}
				]
			}
		]
	};
	assert.throws(() => parseEditDocument(legacyLinear, 'photo-one'));
});

test('accepts detected-subject components with their originating box', () => {
	const mask = createEditMask('mask-one', 'subject');
	mask.name = 'person 1';
	mask.components.push({
		id: 'component-one',
		type: 'ai-instance',
		operation: 'add',
		label: 'person',
		box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
		modelVersion: 'pack-version',
		alternatives: { index: 1, count: 3 },
		raster: null
	});
	const document = { ...defaultEditDocument('photo-one'), masks: [mask] };
	assert.deepEqual(parseEditDocument(document, 'photo-one').masks, [mask]);
	assert.equal(
		editMaskSchema.safeParse({
			...mask,
			components: [{ ...mask.components[0], box: { x: 0.75, y: 0, width: 0.5, height: 0.5 } }]
		}).success,
		false
	);
	assert.equal(
		editMaskSchema.safeParse({
			...mask,
			components: [{ ...mask.components[0], alternatives: { index: 3, count: 3 } }]
		}).success,
		false
	);
});
