import assert from 'node:assert/strict';
import test from 'node:test';

import {
	colorRangeSchema,
	createEditMask,
	defaultColorRange,
	defaultLuminanceRange,
	luminanceRangeSchema,
	type ColorRangeComponent,
	type EditMask,
	type LuminanceRangeComponent
} from '../src/lib/edit-document.ts';
import type { EditorCommand } from '../src/lib/editor-command.ts';
import {
	COLOR_RANGE_SLIDERS,
	LUMINANCE_RANGE_SLIDERS,
	MaskRanging,
	rangeSliderSpecs,
	rangeSliderValue,
	withRangeControl
} from '../src/lib/mask-ranging.ts';
import type { RangeComponentInput } from '../src/lib/worker-protocol.ts';

function stubbed<T>(onlyTheMembersItReads: unknown): T {
	return onlyTheMembersItReads as T;
}

interface Deferred {
	input: RangeComponentInput;
	resolve: (alpha: number) => void;
}

function rangingHarness(options: { manual?: boolean } = {}) {
	const mask = createEditMask('mask-one', 'luminance');
	const dispatched: EditorCommand[] = [];
	const persisted: string[] = [];
	const rasterized: RangeComponentInput[] = [];
	const pending: Deferred[] = [];
	const workerClient = {
		rasterizeRange: (component: RangeComponentInput) => {
			rasterized.push(component);
			if (!options.manual) {
				return Promise.resolve({
					width: 4,
					height: 2,
					alpha: new Uint8Array(8).fill(rasterized.length)
				});
			}
			return new Promise<{ width: number; height: number; alpha: Uint8Array }>((resolve) => {
				pending.push({
					input: component,
					resolve: (fill: number) =>
						resolve({ width: 4, height: 2, alpha: new Uint8Array(8).fill(fill) })
				});
			});
		}
	};
	const pipeline = {
		persistMaskRaster: async (
			photoId: string,
			componentId: string,
			raster: { width: number; height: number; alpha: Uint8Array }
		) => {
			persisted.push(componentId);
			return {
				storageName: `${photoId}/${componentId}.bin`,
				width: raster.width,
				height: raster.height,
				digest: 'c'.repeat(64)
			};
		}
	};
	const host = {
		selectedPhoto: { id: 'photo-one' } as { id: string } | null,
		canAdjustLight: true,
		masks: [mask] as EditMask[],
		selectedMaskId: mask.id as string | null,
		selectedMaskRaster: null as {
			maskId: string;
			width: number;
			height: number;
			alpha: Uint8Array;
		} | null,
		maskStorageAvailable: true,
		failures: [] as unknown[],
		dispatchEditorCommand: (command: EditorCommand) => {
			dispatched.push(command);
			if (command.type === 'mask.component.set') {
				const target = host.masks.find(({ id }) => id === command.maskId);
				if (target) {
					const index = target.components.findIndex(({ id }) => id === command.component.id);
					if (index === -1) target.components.push(command.component);
					else target.components[index] = command.component;
				}
			}
			return true;
		},
		selectMask: () => {},
		failSmartMask: (error: unknown) => {
			host.failures.push(error);
		}
	};
	const ranging = new MaskRanging(stubbed(workerClient), stubbed(pipeline), stubbed(host), 0);
	return { ranging, mask, host, dispatched, persisted, rasterized, pending };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

test('the default ranges satisfy their schemas', () => {
	assert.deepEqual(luminanceRangeSchema.parse(defaultLuminanceRange()), defaultLuminanceRange());
	assert.deepEqual(colorRangeSchema.parse(defaultColorRange()), defaultColorRange());
});

test('addRangeComponent rasterizes from the source, persists, and dispatches one command', async () => {
	const { ranging, mask, dispatched, persisted, rasterized } = rangingHarness();
	await ranging.addRangeComponent('luminance', 'add');
	assert.equal(rasterized.length, 1);
	assert.deepEqual(rasterized[0], { type: 'luminance-range', range: defaultLuminanceRange() });
	assert.equal(persisted.length, 1);
	assert.equal(dispatched.length, 1);
	const command = dispatched[0]!;
	assert.ok(command.type === 'mask.component.set');
	assert.equal(command.maskId, mask.id);
	assert.ok(command.component.type === 'luminance-range');
	assert.equal(command.component.operation, 'add');
	assert.deepEqual(command.component.range, defaultLuminanceRange());
	assert.equal(command.component.raster?.storageName, `photo-one/${command.component.id}.bin`);
	assert.equal(command.component.raster?.width, 4);
	assert.equal(command.component.raster?.height, 2);

	await ranging.addRangeComponent('color', 'intersect');
	assert.equal(dispatched.length, 2);
	const second = dispatched[1]!;
	assert.ok(second.type === 'mask.component.set');
	assert.ok(second.component.type === 'color-range');
	assert.equal(second.component.operation, 'intersect');
	assert.deepEqual(second.component.range, defaultColorRange());
	assert.notEqual(second.component.id, command.component.id);
});

test('addRangeComponent needs storage, a ready photo, and a selected mask', async () => {
	const { ranging, host, dispatched } = rangingHarness();
	host.maskStorageAvailable = false;
	await ranging.addRangeComponent('luminance', 'add');
	assert.equal(host.failures.length, 1);
	host.maskStorageAvailable = true;
	host.canAdjustLight = false;
	await ranging.addRangeComponent('luminance', 'add');
	assert.equal(host.failures.length, 2);
	host.canAdjustLight = true;
	host.selectedMaskId = null;
	await ranging.addRangeComponent('luminance', 'add');
	assert.equal(dispatched.length, 0);
});

test('previewRange paints the overlay without persisting or dispatching', async () => {
	const { ranging, mask, host, dispatched, persisted, rasterized } = rangingHarness();
	await ranging.addRangeComponent('luminance', 'add');
	const component = mask.components[0]!;
	const range = { low: 0.2, high: 0.9, feather: 0 };
	ranging.previewRange(component.id, range);
	await tick();
	assert.equal(rasterized.length, 2);
	assert.deepEqual(rasterized[1], { type: 'luminance-range', range });
	assert.equal(host.selectedMaskRaster?.maskId, mask.id);
	assert.equal(host.selectedMaskRaster?.width, 4);
	assert.equal(host.selectedMaskRaster?.alpha[0], 2);
	assert.equal(persisted.length, 1);
	assert.equal(dispatched.length, 1);
});

test('rapid previews collapse into one rasterization', async () => {
	const { ranging, mask, host, rasterized } = rangingHarness();
	await ranging.addRangeComponent('luminance', 'add');
	const component = mask.components[0]!;
	ranging.previewRange(component.id, { low: 0.1, high: 0.9, feather: 0 });
	ranging.previewRange(component.id, { low: 0.2, high: 0.9, feather: 0 });
	ranging.previewRange(component.id, { low: 0.3, high: 0.9, feather: 0 });
	await tick();
	assert.equal(rasterized.length, 2);
	assert.ok(rasterized[1]!.type === 'luminance-range');
	assert.equal(rasterized[1]!.range.low, 0.3);
	assert.equal(host.selectedMaskRaster?.alpha[0], 2);
});

test('a stale preview result is dropped', async () => {
	const { ranging, mask, host, pending, rasterized } = rangingHarness({ manual: true });
	const creation = ranging.addRangeComponent('luminance', 'add');
	await tick();
	pending.shift()!.resolve(1);
	await creation;
	const component = mask.components[0]!;

	ranging.previewRange(component.id, { low: 0.1, high: 0.9, feather: 0 });
	await tick();
	ranging.previewRange(component.id, { low: 0.4, high: 0.9, feather: 0 });
	await tick();
	assert.equal(rasterized.length, 3);
	const [older, newer] = [pending.shift()!, pending.shift()!];
	newer.resolve(9);
	await tick();
	assert.equal(host.selectedMaskRaster?.alpha[0], 9);
	older.resolve(5);
	await tick();
	assert.equal(host.selectedMaskRaster?.alpha[0], 9);

	ranging.previewRange(component.id, { low: 0.5, high: 0.9, feather: 0 });
	await tick();
	host.selectedMaskId = 'mask-elsewhere';
	pending.shift()!.resolve(7);
	await tick();
	assert.equal(host.selectedMaskRaster?.alpha[0], 9);
});

test('commitRange reuses the previewed raster, persists it, and dispatches the range', async () => {
	const { ranging, mask, dispatched, persisted, rasterized } = rangingHarness();
	await ranging.addRangeComponent('color', 'subtract');
	const component = mask.components[0]!;
	const range = { hue: 30, width: 12, saturationFloor: 0.4, feather: 0.5 };
	ranging.previewRange(component.id, range);
	await tick();
	assert.equal(rasterized.length, 2);
	await ranging.commitRange(component.id, range);
	assert.equal(rasterized.length, 2);
	assert.equal(persisted.length, 2);
	assert.equal(dispatched.length, 2);
	const command = dispatched[1]!;
	assert.ok(command.type === 'mask.component.set');
	assert.ok(command.component.type === 'color-range');
	assert.equal(command.component.id, component.id);
	assert.equal(command.component.operation, 'subtract');
	assert.deepEqual(command.component.range, range);
	assert.equal(command.component.raster?.width, 4);

	await ranging.commitRange(component.id, { ...range, hue: 31 });
	assert.equal(rasterized.length, 3);
	assert.equal(persisted.length, 3);
	assert.equal(dispatched.length, 3);
});

test('commitRange rejects a range that does not fit its component', async () => {
	const { ranging, mask, host, dispatched } = rangingHarness();
	await ranging.addRangeComponent('luminance', 'add');
	const component = mask.components[0]!;
	await ranging.commitRange(component.id, { low: 0.9, high: 0.1, feather: 0 });
	assert.equal(dispatched.length, 1);
	assert.equal(host.failures.length, 1);
	await ranging.commitRange('component-missing', { low: 0.1, high: 0.9, feather: 0 });
	assert.equal(dispatched.length, 1);
});

test('the range slider tables mirror the panel verbatim with defaults from the range defaults', () => {
	assert.deepEqual(
		LUMINANCE_RANGE_SLIDERS.map(({ control, label, defaultValue, suffix }) => [
			control,
			label,
			defaultValue,
			suffix
		]),
		[
			['low', 'Low', 50, undefined],
			['high', 'High', 100, undefined],
			['feather', 'Feather', 10, undefined]
		]
	);
	assert.deepEqual(
		COLOR_RANGE_SLIDERS.map(({ control, label, defaultValue, suffix }) => [
			control,
			label,
			defaultValue,
			suffix
		]),
		[
			['hue', 'Hue', 210, '°'],
			['width', 'Width', 30, '°'],
			['saturationFloor', 'Saturation floor', 20, undefined],
			['feather', 'Feather', 25, undefined]
		]
	);
});

test('rangeSliderSpecs and rangeSliderValue read a component in slider units', () => {
	const luminance: LuminanceRangeComponent = {
		id: 'component-luminance',
		type: 'luminance-range',
		operation: 'add',
		raster: null,
		range: { low: 0.505, high: 0.9, feather: 0.1 }
	};
	const color: ColorRangeComponent = {
		id: 'component-color',
		type: 'color-range',
		operation: 'add',
		raster: null,
		range: { hue: 210.4, width: 30, saturationFloor: 0.2, feather: 0.25 }
	};
	assert.equal(rangeSliderSpecs(luminance), LUMINANCE_RANGE_SLIDERS);
	assert.equal(rangeSliderSpecs(color), COLOR_RANGE_SLIDERS);
	assert.equal(rangeSliderValue(luminance, LUMINANCE_RANGE_SLIDERS[0]!), 51);
	assert.equal(rangeSliderValue(luminance, LUMINANCE_RANGE_SLIDERS[1]!), 90);
	assert.equal(rangeSliderValue(color, COLOR_RANGE_SLIDERS[0]!), 210);
	assert.equal(rangeSliderValue(color, COLOR_RANGE_SLIDERS[2]!), 20);
});

test('withRangeControl converts slider units and keeps low at or below high', () => {
	const luminance: LuminanceRangeComponent = {
		id: 'component-luminance',
		type: 'luminance-range',
		operation: 'add',
		raster: null,
		range: { low: 0.5, high: 0.6, feather: 0.1 }
	};
	assert.deepEqual(withRangeControl(luminance, 'low', 80), { low: 0.8, high: 0.8, feather: 0.1 });
	assert.deepEqual(withRangeControl(luminance, 'high', 30), { low: 0.3, high: 0.3, feather: 0.1 });
	assert.deepEqual(withRangeControl(luminance, 'feather', 40), {
		low: 0.5,
		high: 0.6,
		feather: 0.4
	});

	const color: ColorRangeComponent = {
		id: 'component-color',
		type: 'color-range',
		operation: 'add',
		raster: null,
		range: { hue: 210, width: 30, saturationFloor: 0.2, feather: 0.25 }
	};
	assert.deepEqual(withRangeControl(color, 'hue', 240), {
		hue: 240,
		width: 30,
		saturationFloor: 0.2,
		feather: 0.25
	});
	assert.deepEqual(withRangeControl(color, 'saturationFloor', 35), {
		hue: 210,
		width: 30,
		saturationFloor: 0.35,
		feather: 0.25
	});
});
