import type { StoredAsset, StoredFrame, StoredMetadata, StoredPhoto } from './library-schema';
import type { EditDocument } from './edit-document';
import type { RawMetadata } from './worker';

export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';

export interface Photo {
	id: string;
	name: string;
	extension: string;
	src: string | null;
	kind: StoredPhoto['kind'];
	frames: StoredFrame[];
	bracketDetection: StoredPhoto['bracketDetection'];
	thumbnailStorageName: string | null;
	metadata: StoredMetadata | null;
	size: number;
	width: number | null;
	height: number | null;
	captured: string;
	importedAt: number;
	rating: number;
	flagged: boolean;
	rejected: boolean;
	colorLabel: ColorLabel;
	stackId: string | null;
	edit: EditDocument;
}

export interface PhotoStack {
	id: string;
	name: string;
	photoIds: string[];
	collapsed: boolean;
}

export function storedPhoto(photo: Photo): StoredPhoto {
	return {
		id: photo.id,
		name: photo.name,
		kind: photo.kind,
		frames: cloneFrames(photo.frames),
		bracketDetection: photo.bracketDetection,
		thumbnailStorageName: photo.thumbnailStorageName,
		metadata: photo.metadata ? { ...photo.metadata } : null,
		importedAt: photo.importedAt,
		width: photo.width,
		height: photo.height,
		rating: photo.rating,
		flagged: photo.flagged,
		rejected: photo.rejected,
		colorLabel: photo.colorLabel,
		stackId: photo.stackId
	};
}

export async function restoredPhoto(
	photo: StoredPhoto,
	loadEdit: (photoId: string) => Promise<EditDocument>
): Promise<Photo> {
	const metadata = photo.metadata ? { ...photo.metadata } : null;
	const frame = primaryStoredFrame(photo);

	const selectedAsset = frame.display ?? frame.raw;
	if (!selectedAsset) throw new Error(`Photo ${photo.name} has no source`);

	return {
		id: photo.id,
		name: photo.name,
		extension: groupLabel(photo.kind, frame, photo.frames.length),
		src: null,
		kind: photo.kind,
		frames: cloneFrames(photo.frames),
		bracketDetection: photo.bracketDetection,
		thumbnailStorageName: photo.thumbnailStorageName,
		metadata,
		size: photo.frames
			.flatMap((candidate) => [candidate.raw, candidate.display])
			.filter((asset): asset is StoredAsset => asset !== null)
			.reduce((total, asset) => total + asset.source.size, 0),
		width: photo.width,
		height: photo.height,
		captured: captureLabel(metadata?.capturedAt, selectedAsset.source.lastModified),
		importedAt: photo.importedAt,
		rating: photo.rating,
		flagged: photo.flagged,
		rejected: photo.rejected,
		colorLabel: photo.colorLabel,
		stackId: photo.stackId,
		edit: await loadEdit(photo.id)
	};
}

export function storedMetadata(metadata: RawMetadata): StoredMetadata {
	return {
		orientation: metadata.orientation,
		cameraMake: metadata.cameraMake,
		cameraModel: metadata.cameraModel,
		lens: metadata.lens,
		capturedAt: metadata.capturedAt,
		exposureSeconds: metadata.exposureSeconds,
		fNumber: metadata.fNumber,
		iso: metadata.iso,
		focalLengthMm: metadata.focalLengthMm
	};
}

export function captureLabel(capturedAt: string | null | undefined, fallback: number) {
	const match = capturedAt?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
	if (!match) return capturedAt ?? dateLabel(fallback);
	const [, year, month, day, hour, minute, second] = match;
	return dateLabel(
		new Date(
			Number(year),
			Number(month) - 1,
			Number(day),
			Number(hour),
			Number(minute),
			Number(second)
		).getTime()
	);
}

function dateLabel(timestamp: number) {
	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(timestamp);
}

export function groupLabel(kind: StoredPhoto['kind'], frame: StoredFrame, frameCount: number) {
	if (kind === 'bracket') return `BRACKET × ${frameCount}`;
	if (kind === 'raw-pair') {
		return `${frame.raw?.source.format.toUpperCase()} + ${frame.display?.source.format.toUpperCase()}`;
	}
	return (frame.display ?? frame.raw)?.source.format.toUpperCase() ?? 'PHOTO';
}

export function primaryStoredFrame(photo: Pick<StoredPhoto, 'kind' | 'frames'>) {
	if (photo.kind !== 'bracket') return photo.frames[0];
	return (
		photo.frames.find(({ filenameExposureHint }) => filenameExposureHint === 0) ??
		photo.frames[Math.floor(photo.frames.length / 2)]
	);
}

export function cloneFrames(frames: StoredFrame[]) {
	return frames.map((frame) => ({
		raw: frame.raw ? cloneAsset(frame.raw) : null,
		display: frame.display ? cloneAsset(frame.display) : null,
		filenameExposureHint: frame.filenameExposureHint
	}));
}

function cloneAsset(asset: StoredAsset) {
	return { ...asset, source: { ...asset.source } };
}
