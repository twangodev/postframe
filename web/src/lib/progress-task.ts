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
	status: DocumentStatus,
	preview: { photoId: string; phase: DevelopPreviewPhase } | null,
	activePhotoId: string | null
): ProgressTask | null {
	if (status.kind === 'loading' && status.photoId === activePhotoId) {
		return {
			label: DEVELOP_LABELS[status.phase],
			detail: developDetail(status),
			progress: developPercent(status),
			error: null
		};
	}
	if (preview && preview.photoId === activePhotoId) {
		return { label: PREVIEW_LABELS[preview.phase], detail: null, progress: null, error: null };
	}
	return null;
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
	return { label: status.detail, detail: null, progress: status.progress, error: null };
}

export function formatBytes(bytes: number) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
