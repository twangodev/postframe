import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ControlReveal,
	REVEAL_MOVEMENT_DURATION,
	REVEAL_TARGETING_DURATION,
	interpolateCurve,
	interpolateScalar,
	type ControlRevealClock,
	type ControlRevealFrame
} from '../src/lib/adjustment-reveal.ts';
import { identityCurve, type CurvePoints } from '../src/lib/develop-settings.ts';

class TestClock implements ControlRevealClock {
	time = 0;
	callbacks = new Map<number, FrameRequestCallback>();
	nextHandle = 1;

	now = () => this.time;
	requestFrame = (callback: FrameRequestCallback) => {
		const handle = this.nextHandle++;
		this.callbacks.set(handle, callback);
		return handle;
	};
	cancelFrame = (handle: number) => {
		this.callbacks.delete(handle);
	};

	advance(milliseconds: number) {
		this.time += milliseconds;
		const callbacks = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of callbacks) callback(this.time);
	}
}

test('the reveal targets before moving and settles at the destination', () => {
	const clock = new TestClock();
	const frames: ControlRevealFrame[] = [];
	const reveal = new ControlReveal((frame) => frames.push(frame), { clock });

	reveal.start();
	assert.deepEqual(frames.at(-1), { phase: 'targeting', progress: 0 });
	clock.advance(REVEAL_TARGETING_DURATION);
	assert.deepEqual(frames.at(-1), { phase: 'moving', progress: 0 });
	clock.advance(REVEAL_MOVEMENT_DURATION / 2);
	assert.equal(frames.at(-1)?.phase, 'moving');
	assert.ok((frames.at(-1)?.progress ?? 0) > 0.5);
	clock.advance(REVEAL_MOVEMENT_DURATION / 2);
	assert.deepEqual(frames.at(-1), { phase: 'settled', progress: 1 });
});

test('starting again cancels the previous animation', () => {
	const clock = new TestClock();
	const frames: ControlRevealFrame[] = [];
	const reveal = new ControlReveal((frame) => frames.push(frame), { clock });

	reveal.start();
	clock.advance(100);
	reveal.start(false);
	assert.deepEqual(frames.at(-1), { phase: 'moving', progress: 0 });
	clock.advance(REVEAL_MOVEMENT_DURATION);
	assert.deepEqual(frames.at(-1), { phase: 'settled', progress: 1 });
});

test('reduced motion settles immediately', () => {
	const frames: ControlRevealFrame[] = [];
	const reveal = new ControlReveal((frame) => frames.push(frame), {
		reduceMotion: () => true
	});

	reveal.start();
	assert.deepEqual(frames, [{ phase: 'settled', progress: 1 }]);
});

test('scalar interpolation clamps progress', () => {
	assert.equal(interpolateScalar(10, 30, -1), 10);
	assert.equal(interpolateScalar(10, 30, 0.25), 15);
	assert.equal(interpolateScalar(10, 30, 2), 30);
});

test('curve interpolation preserves exact endpoints across different point counts', () => {
	const from = identityCurve();
	const to: CurvePoints = Array.from({ length: 17 }, (_, index) => {
		const x = index / 16;
		return { x, y: Math.sqrt(x) };
	});

	assert.deepEqual(interpolateCurve(from, to, 0), from);
	assert.deepEqual(interpolateCurve(from, to, 1), to);
	const halfway = interpolateCurve(from, to, 0.5);
	assert.equal(halfway.length, 17);
	assert.deepEqual(halfway[0], { x: 0, y: 0 });
	assert.deepEqual(halfway.at(-1), { x: 1, y: 1 });
	assert.ok(halfway.every((point, index) => index === 0 || point.x > halfway[index - 1].x));
});
