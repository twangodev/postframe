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

export type StorageSegmentId = (typeof SEGMENT_DEFINITIONS)[number]['id'];

export interface StorageSegment {
	id: StorageSegmentId;
	label: string;
	color: string;
	bytes: number;
}

export interface StorageBreakdown {
	segments: StorageSegment[];
	totalBytes: number;
}

export function storageBreakdown(usage: AssetUsage): StorageBreakdown {
	const segments: StorageSegment[] = SEGMENT_DEFINITIONS.map(({ id, label, color, folders }) => ({
		id,
		label,
		color,
		bytes: folders.reduce((total, folder) => total + usage[folder], 0)
	}));

	return {
		segments,
		totalBytes: segments.reduce((total, { bytes }) => total + bytes, 0)
	};
}

export function segmentBytes(breakdown: StorageBreakdown, id: StorageSegmentId) {
	return breakdown.segments.find((segment) => segment.id === id)?.bytes ?? 0;
}
