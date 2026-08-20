import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';
import type { z } from 'zod';

import {
	EDIT_DOCUMENT_VERSION,
	maskComponentSchema,
	maskKindSchema,
	parseEditDocument
} from '../src/lib/edit-document.ts';

type MaskComponentType = z.infer<typeof maskComponentSchema>['type'];

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

const curveArbitrary = fc
	.uniqueArray(fc.tuple(unit, unit), { minLength: 2, maxLength: 6, selector: ([x]) => x })
	.map((points) => points.sort(([left], [right]) => left - right).map(([x, y]) => ({ x, y })));

const curveSettingsArbitrary = fc.record({
	luminance: curveArbitrary,
	red: curveArbitrary,
	green: curveArbitrary,
	blue: curveArbitrary
});

const bandArbitrary = fc.record({ hue: slider, saturation: slider, luminance: slider });

const mixerArbitrary = fc.record({
	red: bandArbitrary,
	orange: bandArbitrary,
	yellow: bandArbitrary,
	green: bandArbitrary,
	aqua: bandArbitrary,
	blue: bandArbitrary,
	purple: bandArbitrary,
	magenta: bandArbitrary
});

const wheelArbitrary = fc.record({
	hue: bounded(0, 360),
	saturation: bounded(0, 100),
	luminance: slider
});

const gradingArbitrary = fc.record({
	shadows: wheelArbitrary,
	midtones: wheelArbitrary,
	highlights: wheelArbitrary,
	blending: bounded(0, 100),
	balance: slider
});

const detailArbitrary = fc.record({
	texture: slider,
	clarity: slider,
	dehaze: slider,
	sharpenAmount: bounded(0, 150),
	noiseLuminance: bounded(0, 100),
	noiseColor: bounded(0, 100)
});

const effectsArbitrary = fc.record({
	vignetteAmount: slider,
	vignetteMidpoint: bounded(0, 100),
	vignetteRoundness: slider,
	vignetteFeather: bounded(0, 100),
	grainAmount: bounded(0, 100),
	grainSize: bounded(0, 100)
});

const developArbitrary = fc.record({
	light: lightArbitrary,
	color: colorArbitrary,
	curve: curveSettingsArbitrary,
	mixer: mixerArbitrary,
	grading: gradingArbitrary,
	detail: detailArbitrary,
	effects: effectsArbitrary
});

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

const luminanceRange = fc.tuple(componentBase, span, unit).map(([base, [low, high], feather]) => ({
	...base,
	type: 'luminance-range' as const,
	range: { low, high, feather }
}));

const colorRange = fc
	.tuple(componentBase, bounded(0, 360), bounded(0, 90), unit, unit)
	.map(([base, hue, width, saturationFloor, feather]) => ({
		...base,
		type: 'color-range' as const,
		range: { hue, width, saturationFloor, feather }
	}));

const componentArbitraries = {
	'ai-subject': aiSubject,
	'ai-object': aiObject,
	'ai-instance': aiInstance,
	brush,
	linear,
	radial,
	'luminance-range': luminanceRange,
	'color-range': colorRange
} satisfies Record<MaskComponentType, fc.Arbitrary<unknown>>;

const componentArbitrary = fc.oneof(...Object.values(componentArbitraries));

const maskArbitrary = fc.record({
	id: word,
	name: word,
	kind: fc.constantFrom(...maskKindSchema.options),
	visible: fc.boolean(),
	components: fc.array(componentArbitrary, { maxLength: 3 }),
	edge: edgeArbitrary,
	adjustments: fc.record({
		light: lightArbitrary,
		color: colorArbitrary,
		curve: curveSettingsArbitrary,
		mixer: mixerArbitrary,
		grading: gradingArbitrary
	})
});

const snapshotArbitrary = fc.record({
	id: word,
	name: word,
	adjustments: developArbitrary
});

const cameraMatchResultArbitrary = fc.record({
	light: lightArbitrary,
	color: colorArbitrary,
	curve: curveSettingsArbitrary,
	cameraLook: bounded(0, 100),
	meanError: bounded(0, 255),
	p99Error: bounded(0, 255),
	settingsOnlyError: bounded(0, 255),
	fitError: bounded(0, 255)
});

const cameraMatchArbitrary = fc.oneof(
	fc.constant({ status: 'legacy' as const }),
	fc.constant({ status: 'pending' as const }),
	fc.constant({ status: 'dismissed' as const }),
	fc.record({
		status: fc.constant('applied' as const),
		target: fc.constantFrom('camera-jpeg' as const, 'embedded-preview' as const),
		result: cameraMatchResultArbitrary
	})
);

const documentArbitrary = fc
	.record({
		version: fc.constant(EDIT_DOCUMENT_VERSION),
		photoId: word,
		adjustments: developArbitrary,
		geometry: fc.record({
			rotation: bounded(-180, 180),
			flipHorizontal: fc.boolean(),
			flipVertical: fc.boolean(),
			crop: fc.option(regionArbitrary)
		}),
		masks: fc.uniqueArray(maskArbitrary, { selector: (mask) => mask.id, maxLength: 3 }),
		profile: fc.record({
			cameraLook: bounded(0, 100),
			cameraLookEnabled: fc.boolean(),
			cameraMatch: cameraMatchArbitrary
		}),
		snapshots: fc.uniqueArray(snapshotArbitrary, {
			selector: (snapshot) => snapshot.id,
			maxLength: 3
		})
	})
	.map((document) => structuredClone(document));

test('the component arbitrary covers every schema variant', () => {
	const variants = maskComponentSchema.options.map((option) => option.shape.type.value);
	assert.deepEqual(Object.keys(componentArbitraries).sort(), [...variants].sort());
});

test('parsing a valid v10 document returns it unchanged (seed 3301)', () => {
	fc.assert(
		fc.property(documentArbitrary, (document) => {
			const parsed = parseEditDocument(structuredClone(document), document.photoId);
			assert.deepEqual(parsed, document);
		}),
		{ seed: 3301, path: undefined }
	);
});
