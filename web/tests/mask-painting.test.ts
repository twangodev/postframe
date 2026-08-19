import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditMask } from '../src/lib/edit-document.ts';
import { MaskPainting } from '../src/lib/mask-painting.ts';
import type { EditorCommand } from '../src/lib/editor-command.ts';

function stubbed<T>(onlyTheMembersItReads: unknown): T {
	return onlyTheMembersItReads as T;
}

function paintingHarness() {
	const mask = createEditMask('mask-one', 'linear');
	const dispatched: EditorCommand[] = [];
	const persisted: Array<{ photoId: string; componentId: string; width: number; height: number }> =
		[];
	const pipeline = {
		persistMaskRaster: async (
			photoId: string,
			componentId: string,
			plane: { width: number; height: number; alpha: Uint8Array }
		) => {
			persisted.push({ photoId, componentId, width: plane.width, height: plane.height });
			return {
				storageName: `${componentId}.bin`,
				width: plane.width,
				height: plane.height,
				digest: 'a'.repeat(64)
			};
		},
		maskRaster: async () => {
			throw new Error('not used');
		}
	};
	let revision = 0;
	const session = {
		revision: 0,
		nextRevision: () => {
			revision += 1;
			session.revision = revision;
			return revision;
		},
		fail: (error: unknown) => {
			throw error instanceof Error ? error : new Error(String(error));
		}
	};
	const host = {
		selectedPhoto: { id: 'photo-one' },
		canAdjustLight: true,
		editPreview: { src: '', width: 400, height: 200 },
		masks: [mask],
		selectedMaskId: mask.id,
		maskStorageAvailable: true,
		dispatchEditorCommand: (command: EditorCommand) => {
			dispatched.push(command);
			return true;
		},
		selectMask: () => {}
	};
	const painting = new MaskPainting(stubbed(pipeline), stubbed(session), stubbed(host));
	return { painting, mask, dispatched, persisted };
}

test('placeGradientComponent rasterizes, persists, and dispatches one command', async () => {
	const { painting, mask, dispatched, persisted } = paintingHarness();
	const component = {
		id: 'component-one',
		type: 'linear' as const,
		operation: 'add' as const,
		raster: null,
		anchor: { x: 0.5, y: 0.5 },
		rotation: 0,
		compression: 0.2
	};
	await painting.placeGradientComponent(component);
	assert.equal(persisted.length, 1);
	assert.deepEqual(persisted[0], {
		photoId: 'photo-one',
		componentId: 'component-one',
		width: 400,
		height: 200
	});
	assert.equal(dispatched.length, 1);
	const command = dispatched[0]!;
	assert.equal(command.type, 'mask.component.set');
	assert.ok(command.type === 'mask.component.set');
	assert.equal(command.maskId, mask.id);
	assert.ok(command.component.type === 'linear');
	assert.equal(command.component.raster?.storageName, 'component-one.bin');
});

test('placeGradientComponent refuses a kind mismatch with the selected mask', async () => {
	const { painting, dispatched } = paintingHarness();
	await painting.placeGradientComponent({
		id: 'component-two',
		type: 'radial',
		operation: 'add',
		raster: null,
		center: { x: 0.5, y: 0.5 },
		radiusX: 0.2,
		radiusY: 0.2,
		rotation: 0,
		feather: 0.5
	});
	assert.equal(dispatched.length, 0);
});
