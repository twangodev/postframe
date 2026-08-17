import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { parseEditDocument } from '../src/lib/edit-document.ts';

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

const rotationArbitrary = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const extentArbitrary = fc.double({ min: 0.001, max: 1, noNaN: true });

const linear = fc
	.tuple(componentBase, pointArbitrary, rotationArbitrary, extentArbitrary)
	.map(([base, anchor, rotation, compression]) => ({
		...base,
		type: 'linear' as const,
		anchor,
		rotation,
		compression
	}));

const radial = fc
	.tuple(componentBase, pointArbitrary, extentArbitrary, extentArbitrary, rotationArbitrary, unit)
	.map(([base, center, radiusX, radiusY, rotation, feather]) => ({
		...base,
		type: 'radial' as const,
		center,
		radiusX,
		radiusY,
		rotation,
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
		version: fc.constant(9),
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

test('parsing a valid v9 document returns it unchanged (seed 3301)', () => {
	fc.assert(
		fc.property(documentArbitrary, (document) => {
			const parsed = parseEditDocument(structuredClone(document), document.photoId);
			assert.deepEqual(parsed, document);
		}),
		{ seed: 3301, path: undefined }
	);
});
