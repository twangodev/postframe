import assert from 'node:assert/strict';
import test from 'node:test';

import { AutoAdjustments } from '../src/lib/auto-adjustments.ts';
import { defaultDevelopSettings, type DevelopSettings } from '../src/lib/develop-settings.ts';
import { defaultEditDocument } from '../src/lib/edit-document.ts';
import type { Photo } from '../src/lib/photo-record.ts';
import { EYEDROPPER_SAMPLE_RADIUS } from '../src/lib/white-balance.ts';
import type { WhiteBalanceSample } from '../src/lib/worker.ts';

function photo(id: string, adjustments: DevelopSettings): Photo {
	return { id, edit: { ...defaultEditDocument(id), adjustments } } as unknown as Photo;
}

function setup(options: { ready?: boolean; fail?: boolean } = {}) {
	const commits: { adjustments: DevelopSettings; label: string }[] = [];
	const errors: string[] = [];
	const samples: (WhiteBalanceSample | undefined)[] = [];
	const adjustments = {
		...defaultDevelopSettings(),
		light: { ...defaultDevelopSettings().light, contrast: 15 },
		color: { ...defaultDevelopSettings().color, saturation: 20 }
	};
	const host = {
		selectedPhoto: photo('one', adjustments) as Photo | null,
		canAdjustLight: options.ready ?? true,
		reportError: (message: string) => {
			errors.push(message);
		}
	};
	const worker = {
		autoBalance: async (sample?: WhiteBalanceSample) => {
			samples.push(sample);
			if (options.fail) throw new Error('no colour');
			return { temperature: 18, tint: -6 };
		},
		autoTone: async () => {
			if (options.fail) throw new Error('no pixels');
			return { exposure: 0.4, contrast: 0, highlights: 0, shadows: 0, whites: 12, blacks: -8 };
		}
	};
	const controls = {
		commitAdjustments: (next: DevelopSettings, label: string) => {
			commits.push({ adjustments: next, label });
			return true;
		}
	};
	return {
		auto: new AutoAdjustments(worker, controls, host),
		host,
		adjustments,
		commits,
		errors,
		samples
	};
}

test('auto white balance keeps every other control and lands as one history entry', async () => {
	const { auto, adjustments, commits, samples } = setup();
	assert.equal(await auto.whiteBalance(), true);
	assert.deepEqual(samples, [undefined]);
	assert.deepEqual(commits, [
		{
			adjustments: { ...adjustments, color: { ...adjustments.color, temperature: 18, tint: -6 } },
			label: 'auto white balance'
		}
	]);
});

test('the eyedropper samples around the picked point', async () => {
	const { auto, adjustments, commits, samples } = setup();
	assert.equal(await auto.sampleWhiteBalance({ x: 0.3, y: 0.6 }), true);
	assert.deepEqual(samples, [{ x: 0.3, y: 0.6, radius: EYEDROPPER_SAMPLE_RADIUS }]);
	assert.deepEqual(commits, [
		{
			adjustments: { ...adjustments, color: { ...adjustments.color, temperature: 18, tint: -6 } },
			label: 'white balance'
		}
	]);
});

test('auto tone replaces the light group and nothing else', async () => {
	const { auto, adjustments, commits } = setup();
	assert.equal(await auto.tone(), true);
	assert.deepEqual(commits, [
		{
			adjustments: {
				...adjustments,
				light: { exposure: 0.4, contrast: 0, highlights: 0, shadows: 0, whites: 12, blacks: -8 }
			},
			label: 'auto tone'
		}
	]);
});

test('nothing is committed before the document is ready or when the worker fails', async () => {
	const idle = setup({ ready: false });
	assert.equal(await idle.auto.whiteBalance(), false);
	assert.equal(await idle.auto.tone(), false);
	assert.deepEqual(idle.commits, []);
	assert.deepEqual(idle.samples, []);

	const failing = setup({ fail: true });
	assert.equal(await failing.auto.whiteBalance(), false);
	assert.equal(await failing.auto.tone(), false);
	assert.deepEqual(failing.commits, []);
	assert.equal(failing.errors.length, 2);
	assert.match(failing.errors[0] ?? '', /white balance.*no colour/);
	assert.match(failing.errors[1] ?? '', /tone.*no pixels/);
});

test('a result for a photo that is no longer selected is dropped', async () => {
	const { auto, host, commits } = setup();
	const pending = auto.tone();
	host.selectedPhoto = photo('two', defaultDevelopSettings());
	assert.equal(await pending, false);
	assert.deepEqual(commits, []);
});
