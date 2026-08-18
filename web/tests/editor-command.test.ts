import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditMask,
	defaultEditDocument,
	type MaskComponent
} from '../src/lib/edit-document.ts';
import {
	defaultColorSettings,
	defaultDevelopSettings,
	defaultLightSettings,
	identityCurve,
	neutralMaskAdjustments
} from '../src/lib/develop-settings.ts';
import { applyEditorCommand, cloneEditorCommand, curveCommand } from '../src/lib/editor-command.ts';

test('applies light commands immutably with render invalidation', () => {
	const before = defaultEditDocument('photo-one');
	const result = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'light',
		control: 'contrast',
		value: 35
	});
	assert.ok(result);
	assert.equal(result.document.adjustments.light.contrast, 35);
	assert.equal(result.invalidation, 'render');
	assert.equal(result.label, 'contrast +35');
	assert.equal(before.adjustments.light.contrast, 0);
	assert.equal(
		applyEditorCommand(result.document, {
			type: 'adjustment.set',
			group: 'light',
			control: 'contrast',
			value: 35
		}),
		null
	);
});

test('applies global color commands immutably with render invalidation', () => {
	const before = defaultEditDocument('photo-one');
	const result = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'color',
		control: 'saturation',
		value: -20
	});
	assert.ok(result);
	assert.equal(result.document.adjustments.color.saturation, -20);
	assert.equal(result.invalidation, 'render');
	assert.equal(result.label, 'saturation -20');
	assert.equal(before.adjustments.color.saturation, 0);
	assert.equal(
		applyEditorCommand(result.document, {
			type: 'adjustment.set',
			group: 'color',
			control: 'saturation',
			value: -20
		}),
		null
	);
	assert.throws(() =>
		applyEditorCommand(before, {
			type: 'adjustment.set',
			group: 'color',
			control: 'tint',
			value: 101
		})
	);
});

test('applies a whole curve channel as one undoable change', () => {
	const before = defaultEditDocument('photo-one');
	const shaped = [
		{ x: 0, y: 0 },
		{ x: 0.4, y: 0.55 },
		{ x: 1, y: 1 }
	];
	const result = applyEditorCommand(before, curveCommand('luminance', shaped));
	assert.ok(result);
	assert.deepEqual(result.document.adjustments.curve.luminance, shaped);
	assert.deepEqual(result.document.adjustments.curve.red, identityCurve());
	assert.equal(result.invalidation, 'render');
	assert.equal(result.label, 'luminance curve');
	assert.deepEqual(before.adjustments.curve.luminance, identityCurve());
	assert.equal(applyEditorCommand(result.document, curveCommand('luminance', shaped)), null);
	assert.throws(() =>
		applyEditorCommand(
			before,
			curveCommand('red', [
				{ x: 0, y: 0 },
				{ x: 0.5, y: 2 }
			])
		)
	);
});

test('clones a curve command rather than sharing its points', () => {
	const points = [
		{ x: 0, y: 0.2 },
		{ x: 1, y: 1 }
	];
	const command = curveCommand('blue', points);
	const cloned = cloneEditorCommand(command);
	assert.deepEqual(cloned, command);
	assert.notEqual(cloned.type === 'adjustment.set' && cloned.value, points);
});

test('creates, hides, and removes masks through deterministic commands', () => {
	const before = defaultEditDocument('photo-one');
	const created = applyEditorCommand(before, {
		type: 'mask.create',
		mask: createEditMask('mask-one', 'radial')
	});
	assert.ok(created);
	assert.equal(created.document.masks[0]?.name, 'radial gradient');
	assert.equal(created.invalidation, 'render');

	const hidden = applyEditorCommand(created.document, {
		type: 'mask.visibility',
		maskId: 'mask-one',
		visible: false
	});
	assert.ok(hidden);
	assert.equal(hidden.document.masks[0]?.visible, false);

	const removed = applyEditorCommand(hidden.document, {
		type: 'mask.delete',
		maskId: 'mask-one'
	});
	assert.ok(removed);
	assert.deepEqual(removed.document.masks, []);
});

test('updates local light without changing global development settings', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'subject'));
	const changed = applyEditorCommand(document, {
		type: 'mask.light.set',
		maskId: 'mask-one',
		control: 'exposure',
		value: 1.25
	});
	assert.ok(changed);
	assert.equal(changed.invalidation, 'render');
	assert.equal(changed.document.masks[0]?.adjustments.light.exposure, 1.25);
	assert.equal(changed.document.adjustments.light.exposure, 0);
});

test('updates local color without changing light or other masks', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'subject'));
	const changed = applyEditorCommand(document, {
		type: 'mask.color.set',
		maskId: 'mask-one',
		control: 'temperature',
		value: 40
	});
	assert.ok(changed);
	assert.equal(changed.invalidation, 'render');
	assert.equal(changed.label, 'temperature +40');
	assert.equal(changed.document.masks[0]?.adjustments.color.temperature, 40);
	assert.deepEqual(
		changed.document.masks[0]?.adjustments.light,
		document.masks[0]?.adjustments.light
	);
	assert.equal(document.masks[0]?.adjustments.color.temperature, 0);
	assert.equal(
		applyEditorCommand(changed.document, {
			type: 'mask.color.set',
			maskId: 'mask-one',
			control: 'temperature',
			value: 40
		}),
		null
	);
	assert.throws(() =>
		applyEditorCommand(changed.document, {
			type: 'mask.color.set',
			maskId: 'mask-one',
			control: 'saturation',
			value: 101
		})
	);
});

test('updates mask edges without changing the stored component raster', () => {
	const document = defaultEditDocument('photo-one');
	const mask = createEditMask('mask-one', 'subject');
	const component = {
		id: 'component-one',
		type: 'ai-subject',
		operation: 'add',
		inverted: false,
		modelVersion: 'model-one',
		raster: {
			storageName: 'photo-one-component-one.mask',
			width: 2,
			height: 2,
			digest: '0'.repeat(64)
		}
	} satisfies MaskComponent;
	mask.components.push(component);
	document.masks.push(mask);

	const changed = applyEditorCommand(document, {
		type: 'mask.edge.set',
		maskId: mask.id,
		control: 'feather',
		value: 12
	});
	assert.ok(changed);
	assert.equal(changed.invalidation, 'render');
	assert.equal(changed.document.masks[0]?.edge.feather, 12);
	assert.deepEqual(changed.document.masks[0]?.components[0]?.raster, component.raster);
	assert.equal(document.masks[0]?.edge.feather, 0);
});

test('adds and replaces persistent mask components by id', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'object'));
	const component = {
		id: 'component-one',
		type: 'ai-object',
		operation: 'add',
		modelVersion: 'model-one',
		alternatives: { index: 0, count: 3 },
		prompts: [{ label: 'foreground', points: [{ x: 0.5, y: 0.5 }] }],
		raster: {
			storageName: 'photo-one-component-one.mask',
			width: 2,
			height: 2,
			digest: '0'.repeat(64)
		}
	} satisfies MaskComponent;
	const added = applyEditorCommand(document, {
		type: 'mask.component.set',
		maskId: 'mask-one',
		component
	});
	assert.ok(added);
	assert.deepEqual(added.document.masks[0]?.components, [component]);

	const replacement = {
		...component,
		prompts: [...component.prompts, { label: 'background' as const, points: [{ x: 0, y: 0 }] }]
	};
	const replaced = applyEditorCommand(added.document, {
		type: 'mask.component.set',
		maskId: 'mask-one',
		component: replacement
	});
	assert.ok(replaced);
	assert.deepEqual(replaced.document.masks[0]?.components, [replacement]);
});

test('validates geometry commands before committing them', () => {
	const document = defaultEditDocument('photo-one');
	assert.throws(() => applyEditorCommand(document, { type: 'geometry.rotate', rotation: 181 }));
	assert.throws(() =>
		applyEditorCommand(document, {
			type: 'geometry.crop',
			crop: { x: 0.8, y: 0, width: 0.5, height: 1 }
		})
	);
	const flipped = applyEditorCommand(document, {
		type: 'geometry.flip',
		axis: 'horizontal'
	});
	assert.ok(flipped);
	assert.equal(flipped.document.geometry.flipHorizontal, true);
});

test('applies mixer band commands immutably and names the band', () => {
	const before = defaultEditDocument('photo-one');
	const result = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'mixer',
		band: 'orange',
		control: 'saturation',
		value: -55
	});
	assert.ok(result);
	assert.equal(result.document.adjustments.mixer.orange.saturation, -55);
	assert.equal(result.document.adjustments.mixer.red.saturation, 0);
	assert.equal(result.invalidation, 'render');
	assert.equal(result.label, 'orange saturation -55');
	assert.equal(before.adjustments.mixer.orange.saturation, 0);
	assert.equal(
		applyEditorCommand(result.document, {
			type: 'adjustment.set',
			group: 'mixer',
			band: 'orange',
			control: 'saturation',
			value: -55
		}),
		null
	);
	assert.throws(() =>
		applyEditorCommand(before, {
			type: 'adjustment.set',
			group: 'mixer',
			band: 'orange',
			control: 'hue',
			value: 101
		})
	);
});

test('applies grading commands for both a range and the shared sliders', () => {
	const before = defaultEditDocument('photo-one');
	const tinted = applyEditorCommand(before, {
		type: 'adjustment.set',
		group: 'grading',
		range: 'shadows',
		control: 'hue',
		value: 210
	});
	assert.ok(tinted);
	assert.equal(tinted.document.adjustments.grading.shadows.hue, 210);
	assert.equal(tinted.label, 'shadows hue +210');

	const balanced = applyEditorCommand(tinted.document, {
		type: 'adjustment.set',
		group: 'grading',
		control: 'balance',
		value: -25
	});
	assert.ok(balanced);
	assert.equal(balanced.document.adjustments.grading.balance, -25);
	assert.equal(balanced.document.adjustments.grading.shadows.hue, 210);
	assert.equal(balanced.label, 'balance -25');
	assert.throws(() =>
		applyEditorCommand(before, {
			type: 'adjustment.set',
			group: 'grading',
			range: 'shadows',
			control: 'saturation',
			value: -1
		})
	);
});

test('replaces every adjustment at once under one label', () => {
	const before = defaultEditDocument('photo-one');
	const adjustments = {
		...defaultDevelopSettings(),
		light: { ...defaultLightSettings(), exposure: 0.5, contrast: 20 },
		color: { ...defaultColorSettings(), temperature: -15 }
	};
	const result = applyEditorCommand(before, {
		type: 'adjustment.replace',
		adjustments,
		label: 'auto tone'
	});
	assert.ok(result);
	assert.equal(result.label, 'auto tone');
	assert.equal(result.invalidation, 'render');
	assert.deepEqual(result.document.adjustments, adjustments);
	assert.equal(before.adjustments.light.exposure, 0);
	assert.equal(
		applyEditorCommand(result.document, {
			type: 'adjustment.replace',
			adjustments,
			label: 'again'
		}),
		null
	);
	assert.throws(() =>
		applyEditorCommand(before, {
			type: 'adjustment.replace',
			adjustments: { ...adjustments, light: { ...adjustments.light, exposure: 9 } },
			label: 'out of range'
		})
	);
});

test('sets a mask adjustment on the addressed mask only, through one path for every group', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'brush'), createEditMask('mask-two', 'radial'));
	const targets = [
		{ target: { group: 'light', control: 'exposure' }, value: 0.5, label: 'exposure +0.5 EV' },
		{ target: { group: 'color', control: 'tint' }, value: -12, label: 'tint -12' },
		{
			target: { group: 'mixer', band: 'aqua', control: 'saturation' },
			value: -100,
			label: 'aqua saturation -100'
		},
		{
			target: { group: 'grading', range: 'shadows', control: 'hue' },
			value: 200,
			label: 'shadows hue +200'
		},
		{ target: { group: 'grading', control: 'balance' }, value: 30, label: 'balance +30' }
	] as const;
	for (const { target, value, label } of targets) {
		const changed = applyEditorCommand(document, {
			type: 'mask.adjustment.set',
			maskId: 'mask-two',
			target,
			value
		});
		assert.ok(changed, `${label} did not apply`);
		assert.equal(changed.invalidation, 'render');
		assert.equal(changed.label, `mask ${label}`);
		assert.deepEqual(changed.document.masks[0], document.masks[0]);
		assert.deepEqual(changed.document.adjustments, document.adjustments);
		assert.equal(
			neutralMaskAdjustments(changed.document.masks[1]!.adjustments),
			false,
			`${label} left the mask neutral`
		);
		assert.equal(neutralMaskAdjustments(document.masks[1]!.adjustments), true);
		assert.equal(
			applyEditorCommand(changed.document, {
				type: 'mask.adjustment.set',
				maskId: 'mask-two',
				target,
				value
			}),
			null
		);
	}
	const mixed = applyEditorCommand(document, {
		type: 'mask.adjustment.set',
		maskId: 'mask-two',
		target: { group: 'mixer', band: 'aqua', control: 'saturation' },
		value: -100
	});
	assert.equal(mixed?.document.masks[1]?.adjustments.mixer.aqua.saturation, -100);
	assert.equal(mixed?.document.masks[1]?.adjustments.mixer.aqua.hue, 0);
	assert.throws(() =>
		applyEditorCommand(document, {
			type: 'mask.adjustment.set',
			maskId: 'mask-two',
			target: { group: 'mixer', band: 'aqua', control: 'saturation' },
			value: 101
		})
	);
	assert.equal(
		applyEditorCommand(document, {
			type: 'mask.adjustment.set',
			maskId: 'mask-nine',
			target: { group: 'mixer', band: 'aqua', control: 'saturation' },
			value: -100
		}),
		null
	);
});

test('sets a whole mask curve channel as one undoable change', () => {
	const document = defaultEditDocument('photo-one');
	document.masks.push(createEditMask('mask-one', 'brush'), createEditMask('mask-two', 'radial'));
	const shaped = [
		{ x: 0, y: 0 },
		{ x: 0.4, y: 0.55 },
		{ x: 1, y: 1 }
	];
	const command = {
		type: 'mask.curve.set',
		maskId: 'mask-one',
		channel: 'red',
		value: shaped
	} as const;
	const changed = applyEditorCommand(document, command);
	assert.ok(changed);
	assert.equal(changed.invalidation, 'render');
	assert.equal(changed.label, 'mask red curve');
	assert.deepEqual(changed.document.masks[0]?.adjustments.curve.red, shaped);
	assert.deepEqual(changed.document.masks[0]?.adjustments.curve.luminance, identityCurve());
	assert.deepEqual(changed.document.masks[1], document.masks[1]);
	assert.deepEqual(changed.document.adjustments.curve.red, identityCurve());
	assert.deepEqual(document.masks[0]?.adjustments.curve.red, identityCurve());
	assert.equal(applyEditorCommand(changed.document, command), null);
	assert.equal(applyEditorCommand(document, { ...command, maskId: 'mask-nine' }), null);
	assert.throws(() =>
		applyEditorCommand(document, {
			...command,
			value: [
				{ x: 0, y: 0 },
				{ x: 0.5, y: 2 }
			]
		})
	);

	const cloned = cloneEditorCommand(command);
	assert.deepEqual(cloned, command);
	assert.notEqual(cloned.type === 'mask.curve.set' && cloned.value, shaped);
	assert.notEqual(cloned.type === 'mask.curve.set' && cloned.value[1], shaped[1]);
});
