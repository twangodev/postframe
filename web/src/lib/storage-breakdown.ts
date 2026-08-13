import type { AssetFolder, AssetUsage } from './asset-store.ts';

interface SegmentDefinition {
	id: string;
	label: string;
	color: string;
	folders: readonly AssetFolder[];
}

const SEGMENT_DEFINITIONS = [
	{
		id: 'photos',
		label: 'photos',
		color: 'var(--color-accent)',
		folders: ['originals', 'thumbnails']
	},
	{ id: 'edits', label: 'edits', color: 'var(--color-positive)', folders: ['edits', 'masks'] },
	{ id: 'models', label: 'ai models', color: 'var(--color-warning)', folders: ['models'] },
	{ id: 'cache', label: 'render cache', color: 'var(--color-control-active)', folders: ['derived'] }
] as const satisfies readonly SegmentDefinition[];

const OTHER_SEGMENT = {
	id: 'other',
	label: 'other site data',
	color: 'var(--color-control-edge)'
} as const;

export type StorageSegmentId = (typeof SEGMENT_DEFINITIONS)[number]['id'] | typeof OTHER_SEGMENT.id;

export interface StorageSegment {
	id: StorageSegmentId;
	label: string;
	color: string;
	bytes: number;
}

export interface StorageEstimate {
	originUsageBytes: number | null;
	quotaBytes: number | null;
}

export interface StorageBreakdown {
	segments: StorageSegment[];
	appBytes: number;
	originBytes: number | null;
	quotaBytes: number | null;
	freeBytes: number | null;
}

export function storageBreakdown(usage: AssetUsage, estimate: StorageEstimate): StorageBreakdown {
	const segments: StorageSegment[] = SEGMENT_DEFINITIONS.map(({ id, label, color, folders }) => ({
		id,
		label,
		color,
		bytes: folders.reduce((total, folder) => total + usage[folder], 0)
	}));
	const appBytes = segments.reduce((total, { bytes }) => total + bytes, 0);
	const { originUsageBytes: originBytes, quotaBytes } = estimate;

	if (originBytes !== null) {
		segments.push({ ...OTHER_SEGMENT, bytes: Math.max(0, originBytes - appBytes) });
	}

	return {
		segments,
		appBytes,
		originBytes,
		quotaBytes,
		freeBytes:
			originBytes !== null && quotaBytes !== null ? Math.max(0, quotaBytes - originBytes) : null
	};
}

export function segmentBytes(breakdown: StorageBreakdown, id: StorageSegmentId) {
	return breakdown.segments.find((segment) => segment.id === id)?.bytes ?? 0;
}
