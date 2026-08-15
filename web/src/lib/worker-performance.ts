import { post, type RenderPerformanceStage } from './worker-protocol.ts';

let performanceEnabled = false;

export function setPerformanceEnabled(enabled: boolean) {
	performanceEnabled = enabled;
}

export function measure<T>(stage: RenderPerformanceStage, operation: () => T, detail?: string): T {
	const startedAt = performance.now();
	try {
		return operation();
	} finally {
		postMeasurement(stage, startedAt, detail);
	}
}

export async function measureAsync<T>(
	stage: RenderPerformanceStage,
	operation: () => Promise<T>,
	detail?: string
): Promise<T> {
	const startedAt = performance.now();
	try {
		return await operation();
	} finally {
		postMeasurement(stage, startedAt, detail);
	}
}

function postMeasurement(stage: RenderPerformanceStage, startedAt: number, detail?: string) {
	if (!performanceEnabled) return;
	post({
		id: 0,
		type: 'performance',
		measurement: { stage, durationMs: performance.now() - startedAt, detail }
	});
}
