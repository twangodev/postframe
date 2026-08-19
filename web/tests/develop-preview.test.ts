import assert from 'node:assert/strict';
import test from 'node:test';

import { DevelopPreviewController, type DevelopPreviewHost } from '../src/lib/develop-preview.ts';
import { defaultDevelopSettings } from '../src/lib/develop-settings.ts';
import type { PostframeWorkerClient } from '../src/lib/worker-client.ts';

interface RenderedPreview {
	image: ArrayBuffer;
	mediaType: string;
}

const adjustments = defaultDevelopSettings();

function rendered(): RenderedPreview {
	return { image: new Uint8Array([1]).buffer, mediaType: 'image/jpeg' };
}

function host(): DevelopPreviewHost {
	return {
		selectedPhoto: { id: 'photo-1' } as DevelopPreviewHost['selectedPhoto'],
		canAdjustLight: true,
		developPreview: null,
		imageScope: null
	};
}

function controller(previews: { resolve: (preview: RenderedPreview) => void }[], target = host()) {
	const workerClient = {
		preview: () =>
			new Promise<RenderedPreview>((resolve) => {
				previews.push({ resolve });
			}),
		scope: () => new Promise(() => {})
	} as unknown as PostframeWorkerClient;
	const objectUrls = { add: () => {}, revoke: () => {} };
	return {
		develop: new DevelopPreviewController(workerClient, objectUrls as never, target),
		target
	};
}

test('a continuous drag renders previews instead of waiting for a pause', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const previews: { resolve: (preview: RenderedPreview) => void }[] = [];
	const { develop } = controller(previews);

	for (let move = 0; move < 20; move += 1) {
		develop.schedule(adjustments, null);
		t.mock.timers.tick(16);
	}

	assert.ok(
		previews.length >= 1,
		'moving the pointer every 16ms must still produce preview renders'
	);
});

test('a rendered preview reaches the host as the applying image', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const previews: { resolve: (preview: RenderedPreview) => void }[] = [];
	const { develop, target } = controller(previews);

	develop.schedule(adjustments, null);
	t.mock.timers.tick(50);
	assert.ok(previews.length >= 1);

	previews.at(-1)!.resolve(rendered());
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(target.developPreview?.photoId, 'photo-1');
	assert.equal(target.developPreview?.phase, 'applying');
	assert.ok(target.developPreview?.src?.startsWith('blob:'));
});

test('release clears the preview and ignores late renders', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const previews: { resolve: (preview: RenderedPreview) => void }[] = [];
	const { develop, target } = controller(previews);

	develop.schedule(adjustments, null);
	t.mock.timers.tick(50);
	develop.release();

	previews.at(-1)?.resolve(rendered());
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(target.developPreview, null);
});
