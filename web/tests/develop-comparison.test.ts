import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DevelopComparison,
	type DevelopComparisonHost,
	type DevelopComparisonPipeline
} from '../src/lib/develop-comparison.ts';
import { defaultDevelopSettings, withAdjustment } from '../src/lib/develop-settings.ts';
import type { EditDocument } from '../src/lib/edit-document.ts';

const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const edited = withAdjustment(defaultDevelopSettings(), 'light', 'exposure', 1.5);

function document(): EditDocument {
	return {
		version: 11,
		photoId: 'photo-1',
		adjustments: edited,
		geometry: { rotation: 0, flipHorizontal: false, flipVertical: false, crop },
		masks: []
	} as unknown as EditDocument;
}

function setup(overrides: Partial<DevelopComparisonHost> = {}) {
	const calls: string[] = [];
	const pipeline: DevelopComparisonPipeline = {
		clearMaskCompositors: async () => {
			calls.push('clear');
		},
		installMaskCompositors: async () => {
			calls.push('install');
		}
	};
	const host: DevelopComparisonHost = {
		selectedPhoto: { edit: document() } as DevelopComparisonHost['selectedPhoto'],
		canAdjustLight: true,
		comparingOriginal: false,
		renderSettings: { adjustments: edited, crop, revision: 3 },
		...overrides
	};
	return { comparison: new DevelopComparison(pipeline, host), host, calls };
}

test('showing the original renders neutral adjustments once masks are cleared', async () => {
	const { comparison, host, calls } = setup();

	await comparison.show();

	assert.equal(host.comparingOriginal, true);
	assert.deepEqual(host.renderSettings.adjustments, defaultDevelopSettings());
	assert.equal(host.renderSettings.revision, 4);
	assert.deepEqual(
		calls,
		['clear'],
		'masks must be cleared before the neutral render is published'
	);
});

test('the original keeps the crop so the viewport geometry holds still', async () => {
	const { comparison, host } = setup();

	await comparison.show();

	assert.deepEqual(host.renderSettings.crop, crop);
});

test('hiding restores the edited adjustments and reinstalls the masks', async () => {
	const { comparison, host, calls } = setup();

	await comparison.show();
	await comparison.hide();

	assert.equal(host.comparingOriginal, false);
	assert.deepEqual(host.renderSettings.adjustments, edited);
	assert.equal(host.renderSettings.revision, 5);
	assert.deepEqual(calls, ['clear', 'install']);
});

test('showing while already comparing does not republish', async () => {
	const { comparison, host, calls } = setup();

	await comparison.show();
	await comparison.show();

	assert.equal(host.renderSettings.revision, 4);
	assert.deepEqual(calls, ['clear']);
});

test('hiding without comparing does nothing', async () => {
	const { comparison, host, calls } = setup();

	await comparison.hide();

	assert.equal(host.renderSettings.revision, 3);
	assert.deepEqual(calls, []);
});

test('a document that cannot be adjusted never enters comparison', async () => {
	const { comparison, host, calls } = setup({ canAdjustLight: false });

	await comparison.show();

	assert.equal(host.comparingOriginal, false);
	assert.deepEqual(calls, []);
});
