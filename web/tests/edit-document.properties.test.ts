import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { defaultColorSettings } from '../src/lib/develop-settings.ts';
import { parseEditDocument } from '../src/lib/edit-document.ts';
import { defaultMaskEdgeSettings } from '../src/lib/mask-edge-settings.ts';

const bounded = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const unit = bounded(0, 1);
const slider = bounded(-100, 100);

const word = fc
	.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), {
		minLength: 1,
		maxLength: 10
	})
	.map((characters) => characters.join(''));

const digest = fc
	.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 64, maxLength: 64 })
	.map((characters) => characters.join(''));

const lightArbitrary = fc
	.record({
		exposure: bounded(-4, 4),
		contrast: slider,
		highlights: slider,
		shadows: slider,
		whites: slider,
		blacks: slider
	})
	.map((light) => structuredClone(light));

const colorArbitrary = fc.record({
	temperature: slider,
	tint: slider,
	vibrance: slider,
	saturation: slider
});

const edgeArbitrary = fc.record({
	contrast: bounded(0, 100),
	feather: bounded(0, 100),
	shift: slider
});

const pointArbitrary = fc.record({ x: unit, y: unit });

const span = fc
	.tuple(unit, unit)
	.map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)))
	.filter(([start, end]) => end - start >= 0.001);

const regionArbitrary = fc
	.tuple(span, span)
	.map(([[x, right], [y, bottom]]) => ({ x, y, width: right - x, height: bottom - y }))
	.filter(({ x, y, width, height }) => x + width <= 1 && y + height <= 1);

const operationArbitrary = fc.constantFrom<'add' | 'subtract' | 'intersect'>(
	'add',
	'subtract',
	'intersect'
);

const componentBase = fc.record({
	id: word,
	operation: operationArbitrary,
	raster: fc.option(
		fc.record({
			storageName: word,
			width: fc.integer({ min: 1, max: 8192 }),
			height: fc.integer({ min: 1, max: 8192 }),
			digest
		})
	)
});

const alternativesArbitrary = fc
	.integer({ min: 1, max: 5 })
	.chain((count) =>
		fc.record({ index: fc.integer({ min: 0, max: count - 1 }), count: fc.constant(count) })
	);

const aiSubject = fc
	.tuple(componentBase, fc.boolean(), fc.option(word))
	.map(([base, inverted, modelVersion]) => ({
		...base,
		type: 'ai-subject' as const,
		inverted,
		modelVersion
	}));

const promptArbitrary = fc.record({
	label: fc.constantFrom<'foreground' | 'background'>('foreground', 'background'),
	points: fc.array(pointArbitrary, { minLength: 1, maxLength: 3 })
});

const aiObject = fc
	.tuple(
		componentBase,
		fc.option(word),
		fc.option(alternativesArbitrary),
		fc.array(promptArbitrary, { maxLength: 2 })
	)
	.map(([base, modelVersion, alternatives, prompts]) => ({
		...base,
		type: 'ai-object' as const,
		modelVersion,
		...(alternatives ? { alternatives } : {}),
		prompts
	}));

const aiInstance = fc
	.tuple(componentBase, word, regionArbitrary, fc.option(word), fc.option(alternativesArbitrary))
	.map(([base, label, box, modelVersion, alternatives]) => ({
		...base,
		type: 'ai-instance' as const,
		label,
		box,
		modelVersion,
		...(alternatives ? { alternatives } : {})
	}));

const brush = fc
	.tuple(
		componentBase,
		fc.array(
			fc.record({
				points: fc.array(pointArbitrary, { minLength: 1, maxLength: 4 }),
				size: bounded(0.01, 1),
				feather: unit,
				flow: unit
			}),
			{ maxLength: 2 }
		)
	)
	.map(([base, strokes]) => ({ ...base, type: 'brush' as const, strokes }));

const linear = fc
	.tuple(componentBase, pointArbitrary, pointArbitrary)
	.map(([base, start, end]) => ({ ...base, type: 'linear' as const, start, end }));

const radial = fc
	.tuple(componentBase, pointArbitrary, bounded(0.01, 1), unit)
	.map(([base, center, radius, feather]) => ({
		...base,
		type: 'radial' as const,
		center,
		radius,
		feather
	}));

const componentArbitrary = fc.oneof(aiSubject, aiObject, aiInstance, brush, linear, radial);

const maskArbitrary = fc.record({
	id: word,
	name: word,
	kind: fc.constantFrom<
		'brush' | 'linear' | 'radial' | 'object' | 'subject' | 'sky' | 'background'
	>('brush', 'linear', 'radial', 'object', 'subject', 'sky', 'background'),
	visible: fc.boolean(),
	components: fc.array(componentArbitrary, { maxLength: 3 }),
	edge: edgeArbitrary,
	adjustments: fc.record({ light: lightArbitrary, color: colorArbitrary })
});

const documentArbitrary = fc
	.record({
		version: fc.constant(8),
		photoId: word,
		adjustments: fc.record({ light: lightArbitrary, color: colorArbitrary }),
		geometry: fc.record({
			rotation: bounded(-180, 180),
			flipHorizontal: fc.boolean(),
			flipVertical: fc.boolean(),
			crop: fc.option(regionArbitrary)
		}),
		masks: fc.uniqueArray(maskArbitrary, { selector: (mask) => mask.id, maxLength: 3 })
	})
	.map((document) => structuredClone(document));

type GeneratedDocument = typeof documentArbitrary extends fc.Arbitrary<infer Value> ? Value : never;

function currentMasks(
	document: GeneratedDocument,
	edge?: () => { contrast: number; feather: number; shift: number }
) {
	return document.masks.map((mask) => ({
		...mask,
		...(edge ? { edge: edge() } : {}),
		adjustments: { light: mask.adjustments.light, color: defaultColorSettings() }
	}));
}

function withDefaultGlobalColor(document: GeneratedDocument) {
	return {
		...document,
		adjustments: { light: document.adjustments.light, color: defaultColorSettings() }
	};
}

test('parsing a valid v8 document returns it unchanged (seed 3301)', () => {
	fc.assert(
		fc.property(documentArbitrary, (document) => {
			const parsed = parseEditDocument(structuredClone(document), document.photoId);
			assert.deepEqual(parsed, document);
		}),
		{ seed: 3301, path: undefined }
	);
});

test('v7 documents migrate to v8 with default global color (seed 3306)', () => {
	fc.assert(
		fc.property(documentArbitrary, (document) => {
			const legacy = {
				...document,
				version: 7,
				adjustments: { light: document.adjustments.light }
			};
			const parsed = parseEditDocument(structuredClone(legacy), document.photoId);
			assert.deepEqual(parsed, withDefaultGlobalColor(document));
		}),
		{ seed: 3306, path: undefined }
	);
});

test('v4-v6 documents migrate to v8 with default mask color and stable ids (seed 3302)', () => {
	fc.assert(
		fc.property(documentArbitrary, fc.constantFrom(4, 5, 6), (document, version) => {
			const legacy = {
				...document,
				version,
				adjustments: { light: document.adjustments.light },
				masks: document.masks.map((mask) => ({
					...mask,
					adjustments: { light: mask.adjustments.light }
				}))
			};
			const parsed = parseEditDocument(structuredClone(legacy), document.photoId);
			assert.deepEqual(parsed, {
				...withDefaultGlobalColor(document),
				masks: currentMasks(document)
			});
		}),
		{ seed: 3302, path: undefined }
	);
});

test('v3 documents migrate to v8 with default edge, color, and stable ids (seed 3303)', () => {
	fc.assert(
		fc.property(documentArbitrary, (document) => {
			const legacy = {
				...document,
				version: 3,
				adjustments: { light: document.adjustments.light },
				masks: document.masks.map(({ edge: _edge, ...mask }) => ({
					...mask,
					adjustments: { light: mask.adjustments.light }
				}))
			};
			const parsed = parseEditDocument(structuredClone(legacy), document.photoId);
			assert.deepEqual(parsed, {
				...withDefaultGlobalColor(document),
				masks: currentMasks(document, defaultMaskEdgeSettings)
			});
		}),
		{ seed: 3303, path: undefined }
	);
});

test('v2 documents migrate to v8 and drop their masks (seed 3304)', () => {
	fc.assert(
		fc.property(
			documentArbitrary,
			fc.array(fc.oneof(word, fc.constant(null), fc.record({ stray: word })), { maxLength: 2 }),
			(document, strayMasks) => {
				const legacy = {
					...document,
					version: 2,
					adjustments: { light: document.adjustments.light },
					masks: strayMasks
				};
				const parsed = parseEditDocument(structuredClone(legacy), document.photoId);
				assert.deepEqual(parsed, { ...withDefaultGlobalColor(document), masks: [] });
			}
		),
		{ seed: 3304, path: undefined }
	);
});

test('v1 develop settings migrate to a default v8 document keeping light (seed 3305)', () => {
	fc.assert(
		fc.property(lightArbitrary, word, (light, photoId) => {
			const parsed = parseEditDocument({ version: 1, ...light }, photoId);
			assert.deepEqual(parsed, {
				version: 8,
				photoId,
				adjustments: { light, color: defaultColorSettings() },
				geometry: { rotation: 0, flipHorizontal: false, flipVertical: false, crop: null },
				masks: []
			});
		}),
		{ seed: 3305, path: undefined }
	);
});
