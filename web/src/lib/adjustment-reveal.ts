import type { CurvePoints } from './develop-settings.ts';
import { curveSamples } from './tone-curve.ts';

export const REVEAL_TARGETING_DURATION = 250;
export const REVEAL_MOVEMENT_DURATION = 450;
export const REVEAL_CURVE_RESOLUTION = 17;

export type ControlRevealPhase = 'idle' | 'targeting' | 'moving' | 'settled';

export interface ControlRevealFrame {
	phase: ControlRevealPhase;
	progress: number;
}

export interface ControlRevealClock {
	now: () => number;
	requestFrame: (callback: FrameRequestCallback) => number;
	cancelFrame: (handle: number) => void;
}

interface ControlRevealOptions {
	reduceMotion?: () => boolean;
	clock?: ControlRevealClock;
}

const browserClock: ControlRevealClock = {
	now: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle)
};

export class ControlReveal {
	#frame: number | null = null;
	#sequence = 0;
	#present: (frame: ControlRevealFrame) => void;
	#options: ControlRevealOptions;

	constructor(present: (frame: ControlRevealFrame) => void, options: ControlRevealOptions = {}) {
		this.#present = present;
		this.#options = options;
	}

	start(targetFirst = true) {
		this.stop();
		if (this.reducedMotion()) {
			this.#present({ phase: 'settled', progress: 1 });
			return;
		}

		const sequence = ++this.#sequence;
		if (targetFirst) {
			this.animate('targeting', REVEAL_TARGETING_DURATION, sequence, () =>
				this.animateMovement(sequence)
			);
		} else {
			this.animateMovement(sequence);
		}
	}

	settle(progress = 1) {
		this.stop();
		this.#present({ phase: 'settled', progress: unitClamped(progress) });
	}

	stop() {
		this.#sequence += 1;
		if (this.#frame !== null) this.clock.cancelFrame(this.#frame);
		this.#frame = null;
	}

	private animateMovement(sequence: number) {
		this.animate('moving', REVEAL_MOVEMENT_DURATION, sequence, () => {
			this.#frame = null;
			this.#present({ phase: 'settled', progress: 1 });
		});
	}

	private animate(
		phase: Exclude<ControlRevealPhase, 'idle' | 'settled'>,
		duration: number,
		sequence: number,
		complete: () => void
	) {
		const startedAt = this.clock.now();
		this.#present({ phase, progress: 0 });
		const tick = (now: number) => {
			if (sequence !== this.#sequence) return;
			const progress = unitClamped(Math.max(0, now - startedAt) / duration);
			this.#present({ phase, progress: easeOut(progress) });
			if (progress < 1) this.#frame = this.clock.requestFrame(tick);
			else complete();
		};
		this.#frame = this.clock.requestFrame(tick);
	}

	private reducedMotion() {
		return (
			this.#options.reduceMotion?.() ??
			(typeof window !== 'undefined' &&
				window.matchMedia('(prefers-reduced-motion: reduce)').matches)
		);
	}

	private get clock() {
		return this.#options.clock ?? browserClock;
	}
}

export function interpolateScalar(from: number, to: number, progress: number) {
	return from + (to - from) * unitClamped(progress);
}

export function interpolateCurve(
	from: CurvePoints,
	to: CurvePoints,
	progress: number,
	resolution = REVEAL_CURVE_RESOLUTION
): CurvePoints {
	const amount = unitClamped(progress);
	if (amount === 0) return clonedCurve(from);
	if (amount === 1) return clonedCurve(to);

	const count = Math.max(2, resolution);
	const fromSamples = curveSamples(from, count);
	const toSamples = curveSamples(to, count);
	return fromSamples.map((value, index) => ({
		x: index / (count - 1),
		y: interpolateScalar(value, toSamples[index], amount)
	}));
}

function clonedCurve(points: CurvePoints): CurvePoints {
	return points.map(({ x, y }) => ({ x, y }));
}

function easeOut(progress: number) {
	return 1 - Math.pow(1 - progress, 3);
}

function unitClamped(value: number) {
	return Math.min(Math.max(value, 0), 1);
}
