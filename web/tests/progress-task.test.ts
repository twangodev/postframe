import assert from 'node:assert/strict';
import test from 'node:test';

import {
	backgroundTasks,
	formatBytes,
	progressKind,
	smartMaskTask,
	viewportTask
} from '../src/lib/progress-task.ts';
import type { DocumentStatus, SmartMaskStatus } from '../src/lib/workspace.svelte.ts';

type Loading = Extract<DocumentStatus, { kind: 'loading' }>;

const loading = (overrides: Partial<Loading> = {}): DocumentStatus => ({
	kind: 'loading',
	photoId: 'p1',
	phase: 'reading',
	bytesRead: 0,
	totalBytes: 0,
	framesDecoded: 0,
	totalFrames: 1,
	activeFrame: 1,
	...overrides
});

const mask = (overrides: Partial<SmartMaskStatus> = {}): SmartMaskStatus => ({
	phase: 'idle',
	progress: null,
	detail: '',
	error: null,
	...overrides
});

const developProjection = (overrides: Partial<Loading> = {}) =>
	backgroundTasks(loading(overrides), mask(), mask())[0]?.task;

test('reading with known size reports bytes and percent', () => {
	const task = developProjection({ bytesRead: 1024 * 1024, totalBytes: 4 * 1024 * 1024 });
	assert.deepEqual(task, {
		label: 'reading originals',
		detail: '1.0 MB / 4.0 MB',
		progress: 25,
		error: null
	});
});

test('reading with unknown size is indeterminate', () => {
	assert.deepEqual(developProjection(), {
		label: 'reading originals',
		detail: 'locating originals',
		progress: null,
		error: null
	});
});

test('multi-frame decoding reports frame counts and percent', () => {
	const task = developProjection({
		phase: 'decoding',
		framesDecoded: 1,
		totalFrames: 4,
		activeFrame: 2
	});
	assert.deepEqual(task, {
		label: 'decoding raw',
		detail: 'frame 2 / 4',
		progress: 25,
		error: null
	});
});

test('single-frame decoding is indeterminate', () => {
	const task = developProjection({ phase: 'decoding' });
	assert.equal(task?.progress, null);
	assert.equal(task?.detail, 'frame 1 / 1');
});

test('merging and rendering phases label without percent', () => {
	assert.deepEqual(developProjection({ phase: 'merging', totalFrames: 3 }), {
		label: 'aligning + merging',
		detail: '3 exposures',
		progress: null,
		error: null
	});
	assert.equal(developProjection({ phase: 'merging' })?.detail, 'building image');
	assert.deepEqual(developProjection({ phase: 'rendering' }), {
		label: 'rendering preview',
		detail: 'SDR preview',
		progress: null,
		error: null
	});
});

test('viewport shows only the active photo preview', () => {
	assert.deepEqual(viewportTask({ photoId: 'p1', phase: 'applying' }, 'p1'), {
		label: 'applying light',
		detail: null,
		progress: null,
		error: null
	});
	assert.equal(viewportTask({ photoId: 'p1', phase: 'refining' }, 'p1')?.label, 'refining tiles');
	assert.equal(viewportTask({ photoId: 'p2', phase: 'applying' }, 'p1'), null);
	assert.equal(viewportTask(null, 'p1'), null);
});

test('smart mask working phases pass detail and percent through', () => {
	assert.equal(smartMaskTask(mask()), null);
	assert.equal(smartMaskTask(mask({ phase: 'ready', progress: 100 })), null);
	assert.deepEqual(
		smartMaskTask(mask({ phase: 'downloading', progress: 41, detail: 'object model' })),
		{
			label: 'object model',
			detail: null,
			progress: 41,
			error: null
		}
	);
	assert.deepEqual(smartMaskTask(mask({ phase: 'encoding', detail: 'analyzing photo' })), {
		label: 'analyzing photo',
		detail: null,
		progress: null,
		error: null
	});
});

test('smart mask errors surface regardless of phase', () => {
	assert.deepEqual(
		smartMaskTask(mask({ phase: 'error', detail: 'model failed', error: 'model failed' })),
		{
			label: 'model failed',
			detail: null,
			progress: null,
			error: 'model failed'
		}
	);
});

test('formatBytes switches units at one megabyte', () => {
	assert.equal(formatBytes(512), '0.5 KB');
	assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

test('progressKind discriminates on percent presence', () => {
	assert.equal(progressKind({ label: 'x', detail: null, progress: 40, error: null }), 'realtime');
	assert.equal(progressKind({ label: 'x', detail: null, progress: null, error: null }), 'infinite');
});

test('backgroundTasks composes develop, smart mask, and preload in order', () => {
	const tasks = backgroundTasks(
		loading({ bytesRead: 1024, totalBytes: 4096 }),
		mask({ phase: 'encoding', detail: 'analyzing photo' }),
		mask({ phase: 'downloading', progress: 60, detail: 'object model' })
	);
	assert.deepEqual(
		tasks.map((entry) => [entry.key, entry.name, entry.kind]),
		[
			['develop', 'developing photo', 'realtime'],
			['smart-mask', 'smart mask', 'infinite'],
			['model-preload', 'smart mask models', 'realtime']
		]
	);
	assert.equal(tasks[0].task.label, 'reading originals');
});

test('backgroundTasks omits idle, ready, and terminal sources', () => {
	assert.deepEqual(
		backgroundTasks({ kind: 'idle' }, mask(), mask({ phase: 'ready', progress: 100 })),
		[]
	);
	for (const status of [
		{ kind: 'ready', photoId: 'p1', boostStops: null },
		{ kind: 'cancelled', photoId: 'p1' },
		{ kind: 'error', photoId: 'p1', message: 'boom' }
	] satisfies DocumentStatus[]) {
		assert.deepEqual(backgroundTasks(status, mask(), mask()), []);
	}
});

test('backgroundTasks keeps preload errors visible', () => {
	const tasks = backgroundTasks(
		{ kind: 'idle' },
		mask(),
		mask({ phase: 'error', detail: 'download failed', error: 'download failed' })
	);
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].key, 'model-preload');
	assert.equal(tasks[0].task.error, 'download failed');
});

test('develop entry ignores photo identity', () => {
	const tasks = backgroundTasks(loading({ photoId: 'other' }), mask(), mask());
	assert.equal(tasks[0]?.key, 'develop');
});
