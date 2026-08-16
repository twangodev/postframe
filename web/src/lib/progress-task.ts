import { formatBytes } from './format-bytes.ts';
import { formatDuration } from './format-duration.ts';
import type { SmartMaskTransfer } from './smart-mask.ts';
import type { DevelopPhase } from './worker';
import type { DevelopPreviewPhase, DocumentStatus, SmartMaskStatus } from './workspace.svelte';

export interface ProgressTask {
	label: string;
	detail: string | null;
	progress: number | null;
	error: string | null;
}

const DEVELOP_LABELS: Record<DevelopPhase, string> = {
	reading: 'reading originals',
	decoding: 'decoding raw',
	merging: 'aligning + merging',
	rendering: 'rendering preview'
};

const PREVIEW_LABELS: Record<DevelopPreviewPhase, string> = {
	applying: 'applying light',
	refining: 'refining tiles'
};

type LoadingStatus = Extract<DocumentStatus, { kind: 'loading' }>;

export function viewportTask(
	preview: { photoId: string; phase: DevelopPreviewPhase } | null,
	activePhotoId: string | null
): ProgressTask | null {
	if (preview && preview.photoId === activePhotoId) {
		return { label: PREVIEW_LABELS[preview.phase], detail: null, progress: null, error: null };
	}
	return null;
}

function developTask(status: LoadingStatus): ProgressTask {
	return {
		label: DEVELOP_LABELS[status.phase],
		detail: developDetail(status),
		progress: developPercent(status),
		error: null
	};
}

function developDetail(status: LoadingStatus) {
	switch (status.phase) {
		case 'reading':
			return status.totalBytes > 0
				? `${formatBytes(status.bytesRead)} / ${formatBytes(status.totalBytes)}`
				: 'locating originals';
		case 'decoding':
			return `frame ${status.activeFrame} / ${status.totalFrames}`;
		case 'merging':
			return status.totalFrames > 1 ? `${status.totalFrames} exposures` : 'building image';
		case 'rendering':
			return 'SDR preview';
	}
}

function developPercent(status: LoadingStatus) {
	if (status.phase === 'reading' && status.totalBytes > 0) {
		return (status.bytesRead / status.totalBytes) * 100;
	}
	if (status.phase === 'decoding' && status.totalFrames > 1) {
		return (status.framesDecoded / status.totalFrames) * 100;
	}
	return null;
}

const SMART_MASK_WORKING: ReadonlySet<SmartMaskStatus['phase']> = new Set([
	'downloading',
	'loading',
	'encoding',
	'refining'
]);

export function smartMaskTask(status: SmartMaskStatus): ProgressTask | null {
	if (status.error !== null) {
		return { label: status.detail, detail: null, progress: null, error: status.error };
	}
	if (!SMART_MASK_WORKING.has(status.phase)) return null;
	return {
		label: status.detail,
		detail: status.transfer ? transferDetail(status.transfer) : null,
		progress: status.progress,
		error: null
	};
}

function transferDetail({ bytesPerSecond, secondsLeft }: SmartMaskTransfer) {
	const rate = `${formatBytes(bytesPerSecond)}/s`;
	return secondsLeft === null ? rate : `${rate} · ${formatDuration(secondsLeft)} left`;
}

export type ProgressKind = 'realtime' | 'infinite';

export interface BackgroundTask {
	key: string;
	name: string;
	kind: ProgressKind;
	task: ProgressTask;
}

export function progressKind(task: ProgressTask): ProgressKind {
	return task.progress === null ? 'infinite' : 'realtime';
}

export function backgroundTasks(
	status: DocumentStatus,
	smartMask: SmartMaskStatus,
	preload: SmartMaskStatus
): BackgroundTask[] {
	const entries: BackgroundTask[] = [];
	if (status.kind === 'loading') {
		entries.push(entry('develop', 'developing photo', developTask(status)));
	}
	const maskTask = smartMaskTask(smartMask);
	if (maskTask) entries.push(entry('smart-mask', 'smart mask', maskTask));
	const preloadTask = smartMaskTask(preload);
	if (preloadTask) entries.push(entry('model-preload', 'smart mask models', preloadTask));
	return entries;
}

function entry(key: string, name: string, task: ProgressTask): BackgroundTask {
	return { key, name, kind: progressKind(task), task };
}
