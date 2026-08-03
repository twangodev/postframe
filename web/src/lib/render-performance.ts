import type { RenderPerformanceMeasurement, RenderPerformanceStage } from './worker.ts';

const DEFAULT_SAMPLE_CAPACITY = 256;
const STAGE_ORDER: readonly RenderPerformanceStage[] = [
	'file-read',
	'cache-read',
	'cache-restore',
	'cache-write',
	'raw-decode',
	'display-decode',
	'merge',
	'preview',
	'tile'
];

export interface RenderRuntimeSummary {
	threaded: boolean;
	threadCount: number;
}

export interface RenderPerformanceSeries {
	stage: RenderPerformanceStage;
	detail: string | null;
	samples: number;
	minMs: number;
	medianMs: number;
	p95Ms: number;
	meanMs: number;
	maxMs: number;
}

export interface RenderPerformanceReport {
	runtime: RenderRuntimeSummary | null;
	sampleCapacity: number;
	totalSamples: number;
	series: RenderPerformanceSeries[];
}

export interface RenderPerformanceControls {
	snapshot: () => RenderPerformanceReport;
	clear: () => void;
}

declare global {
	interface Window {
		__postframePerformance?: RenderPerformanceControls;
	}
}

interface Samples {
	stage: RenderPerformanceStage;
	detail: string | null;
	durations: number[];
}

export class RenderPerformanceRecorder {
	private readonly entries = new Map<string, Samples>();
	private readonly sampleCapacity: number;

	constructor(sampleCapacity = DEFAULT_SAMPLE_CAPACITY) {
		if (!Number.isInteger(sampleCapacity) || sampleCapacity < 1) {
			throw new Error('Render performance sample capacity must be a positive integer');
		}
		this.sampleCapacity = sampleCapacity;
	}

	record(measurement: RenderPerformanceMeasurement) {
		if (!Number.isFinite(measurement.durationMs) || measurement.durationMs < 0) return;
		const detail = measurement.detail ?? null;
		const key = JSON.stringify([measurement.stage, detail]);
		const entry = this.entries.get(key) ?? {
			stage: measurement.stage,
			detail,
			durations: []
		};
		entry.durations.push(measurement.durationMs);
		if (entry.durations.length > this.sampleCapacity) entry.durations.shift();
		this.entries.set(key, entry);
	}

	snapshot(runtime: RenderRuntimeSummary | null = null): RenderPerformanceReport {
		const series = [...this.entries.values()]
			.map(summarize)
			.sort(
				(a, b) =>
					STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
					(a.detail ?? '').localeCompare(b.detail ?? '')
			);
		return {
			runtime: runtime ? { ...runtime } : null,
			sampleCapacity: this.sampleCapacity,
			totalSamples: series.reduce((total, entry) => total + entry.samples, 0),
			series
		};
	}

	clear() {
		this.entries.clear();
	}
}

function summarize({ stage, detail, durations }: Samples): RenderPerformanceSeries {
	const sorted = durations.toSorted((a, b) => a - b);
	return {
		stage,
		detail,
		samples: sorted.length,
		minMs: milliseconds(sorted[0]!),
		medianMs: milliseconds(percentile(sorted, 0.5)),
		p95Ms: milliseconds(percentile(sorted, 0.95)),
		meanMs: milliseconds(sorted.reduce((total, value) => total + value, 0) / sorted.length),
		maxMs: milliseconds(sorted.at(-1)!)
	};
}

function percentile(sorted: readonly number[], fraction: number) {
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const weight = position - lower;
	return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function milliseconds(value: number) {
	return Math.round(value * 1_000) / 1_000;
}
