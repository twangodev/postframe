import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultCurveSettings,
	defaultGradingSettings,
	defaultMaskAdjustments,
	defaultMixerSettings,
	identityCurve,
	type MaskAdjustmentTarget
} from '../src/lib/develop-settings.ts';
import { globalDevelopBinding, maskDevelopBinding } from '../src/lib/develop-binding.ts';
import { createEditMask } from '../src/lib/edit-document.ts';

const target: MaskAdjustmentTarget = { group: 'mixer', band: 'blue', control: 'saturation' };
const shaped = [
	{ x: 0, y: 0 },
	{ x: 0.5, y: 0.7 },
	{ x: 1, y: 1 }
];

test('the global binding reads the mirror live and forwards to the document controls', () => {
	const calls: unknown[] = [];
	const host = {
		canAdjustLight: false,
		curve: defaultCurveSettings(),
		mixer: defaultMixerSettings(),
		grading: defaultGradingSettings(),
		previewCurve: (...args: unknown[]) => calls.push(['previewCurve', ...args]),
		commitCurve: (...args: unknown[]) => calls.push(['commitCurve', ...args]),
		previewAdjustmentAt: (...args: unknown[]) => calls.push(['previewAdjustmentAt', ...args]),
		commitAdjustmentAt: (...args: unknown[]) => calls.push(['commitAdjustmentAt', ...args]),
		previewAdjustmentsAt: (...args: unknown[]) => calls.push(['previewAdjustmentsAt', ...args]),
		commitAdjustmentsAt: (...args: unknown[]) => calls.push(['commitAdjustmentsAt', ...args])
	};
	const binding = globalDevelopBinding(host);
	assert.equal(binding.disabled, true);
	host.canAdjustLight = true;
	assert.equal(binding.disabled, false);
	assert.equal(binding.curve, host.curve);
	host.mixer = { ...defaultMixerSettings(), red: { hue: 5, saturation: 0, luminance: 0 } };
	assert.equal(binding.mixer, host.mixer);
	assert.equal(binding.grading, host.grading);

	binding.previewCurve('red', shaped);
	binding.commitCurve('red', shaped);
	binding.previewAdjustmentAt(target, -10);
	binding.commitAdjustmentAt(target, -10);
	binding.previewAdjustmentsAt([{ target, value: 5 }]);
	binding.commitAdjustmentsAt([{ target, value: 5 }]);
	assert.deepEqual(calls, [
		['previewCurve', 'red', shaped],
		['commitCurve', 'red', shaped],
		['previewAdjustmentAt', target, -10],
		['commitAdjustmentAt', target, -10],
		['previewAdjustmentsAt', [{ target, value: 5 }]],
		['commitAdjustmentsAt', [{ target, value: 5 }]]
	]);
});

test('the mask binding reads the selected mask live and forwards to the mask controls', () => {
	const calls: unknown[] = [];
	const mask = createEditMask('mask-one', 'brush');
	const host = {
		canAdjustLight: true,
		selectedMask: mask as ReturnType<typeof createEditMask> | null,
		previewMaskCurve: (...args: unknown[]) => calls.push(['previewMaskCurve', ...args]),
		commitMaskCurve: (...args: unknown[]) => calls.push(['commitMaskCurve', ...args]),
		previewMaskAdjustmentAt: (...args: unknown[]) =>
			calls.push(['previewMaskAdjustmentAt', ...args]),
		commitMaskAdjustmentAt: (...args: unknown[]) => calls.push(['commitMaskAdjustmentAt', ...args]),
		previewMaskAdjustmentsAt: (...args: unknown[]) =>
			calls.push(['previewMaskAdjustmentsAt', ...args]),
		commitMaskAdjustmentsAt: (...args: unknown[]) =>
			calls.push(['commitMaskAdjustmentsAt', ...args])
	};
	const binding = maskDevelopBinding(host);
	assert.equal(binding.disabled, true, 'a mask without components has nothing to adjust');
	mask.components.push({
		id: 'component-one',
		type: 'brush',
		operation: 'add',
		raster: null,
		strokes: []
	});
	assert.equal(binding.disabled, false);
	host.canAdjustLight = false;
	assert.equal(binding.disabled, true);
	host.canAdjustLight = true;

	assert.equal(binding.curve, mask.adjustments.curve);
	assert.equal(binding.mixer, mask.adjustments.mixer);
	assert.equal(binding.grading, mask.adjustments.grading);
	const replaced = createEditMask('mask-one', 'brush');
	replaced.adjustments.curve.red = shaped;
	host.selectedMask = replaced;
	assert.deepEqual(binding.curve.red, shaped);

	binding.previewCurve('red', shaped);
	binding.commitCurve('red', shaped);
	binding.previewAdjustmentAt(target, -10);
	binding.commitAdjustmentAt(target, -10);
	binding.previewAdjustmentsAt([{ target, value: 5 }]);
	binding.commitAdjustmentsAt([{ target, value: 5 }]);
	assert.deepEqual(calls, [
		['previewMaskCurve', 'red', shaped],
		['commitMaskCurve', 'red', shaped],
		['previewMaskAdjustmentAt', target, -10],
		['commitMaskAdjustmentAt', target, -10],
		['previewMaskAdjustmentsAt', [{ target, value: 5 }]],
		['commitMaskAdjustmentsAt', [{ target, value: 5 }]]
	]);
});

test('the mask binding falls back to neutral settings once its mask is gone', () => {
	const binding = maskDevelopBinding({
		canAdjustLight: true,
		selectedMask: null,
		previewMaskCurve: () => {},
		commitMaskCurve: () => {},
		previewMaskAdjustmentAt: () => {},
		commitMaskAdjustmentAt: () => {},
		previewMaskAdjustmentsAt: () => {},
		commitMaskAdjustmentsAt: () => {}
	});
	assert.equal(binding.disabled, true);
	assert.deepEqual(binding.curve.luminance, identityCurve());
	assert.deepEqual(binding.mixer, defaultMaskAdjustments().mixer);
	assert.deepEqual(binding.grading, defaultMaskAdjustments().grading);
});
