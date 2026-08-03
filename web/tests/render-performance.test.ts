import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderPerformanceRecorder } from '../src/lib/render-performance.ts';

test('summarizes render measurements by stage and detail', () => {
	const recorder = new RenderPerformanceRecorder();
	for (const durationMs of [1, 2, 3, 4, 100]) {
		recorder.record({ stage: 'tile', durationMs, detail: 'bin 1' });
	}
	recorder.record({ stage: 'tile', durationMs: 8, detail: 'bin 2' });
	recorder.record({ stage: 'raw-decode', durationMs: 20 });

	assert.deepEqual(recorder.snapshot({ threaded: true, threadCount: 6 }), {
		runtime: { threaded: true, threadCount: 6 },
		sampleCapacity: 256,
		totalSamples: 7,
		series: [
			{
				stage: 'raw-decode',
				detail: null,
				samples: 1,
				minMs: 20,
				medianMs: 20,
				p95Ms: 20,
				meanMs: 20,
				maxMs: 20
			},
			{
				stage: 'tile',
				detail: 'bin 1',
				samples: 5,
				minMs: 1,
				medianMs: 3,
				p95Ms: 80.8,
				meanMs: 22,
				maxMs: 100
			},
			{
				stage: 'tile',
				detail: 'bin 2',
				samples: 1,
				minMs: 8,
				medianMs: 8,
				p95Ms: 8,
				meanMs: 8,
				maxMs: 8
			}
		]
	});
});

test('retains a bounded rolling window and can be cleared', () => {
	const recorder = new RenderPerformanceRecorder(3);
	for (const durationMs of [1, 2, 3, 4]) {
		recorder.record({ stage: 'preview', durationMs });
	}
	recorder.record({ stage: 'preview', durationMs: Number.NaN });

	assert.deepEqual(recorder.snapshot().series[0], {
		stage: 'preview',
		detail: null,
		samples: 3,
		minMs: 2,
		medianMs: 3,
		p95Ms: 3.9,
		meanMs: 3,
		maxMs: 4
	});
	recorder.clear();
	assert.deepEqual(recorder.snapshot().series, []);
});
