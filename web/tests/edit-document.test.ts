import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultGradingSettings,
	defaultMixerSettings,
	identityCurve
} from '../src/lib/develop-settings.ts';
import {
	EDIT_DOCUMENT_VERSION,
	cloneEditDocument,
	createEditMask,
	defaultEditDocument,
	editDocumentStorageName,
	editDocumentSchema,
	editMaskSchema,
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
	assert.equal(document.version, 10);
	assert.deepEqual(editDocumentSchema.parse(document), document);
	assert.deepEqual(cloneEditDocument(document).adjustments, document.adjustments);
	assert.notEqual(
		cloneEditDocument(document).adjustments.curve.luminance,
		document.adjustments.curve.luminance
	);
});

test('keeps mask adjustments tonal while the document carries every group', () => {
	const mask = createEditMask('mask-one', 'brush');
	assert.deepEqual(Object.keys(mask.adjustments), ['light', 'color']);
	assert.deepEqual(Object.keys(defaultEditDocument('photo-one').adjustments), [
		'light',
		'color',
		'curve',
		'mixer',
		'grading',
		'detail',
		'effects'
	]);
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

test('rejects current documents whose masks lack color adjustments', () => {
	const mask = createEditMask('mask-one', 'radial');
	const document = {
		...defaultEditDocument('photo-one'),
		masks: [{ ...mask, adjustments: { light: mask.adjustments.light } }]
	};
	assert.equal(editDocumentSchema.safeParse(document).success, false);
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
