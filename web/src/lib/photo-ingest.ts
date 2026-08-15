import {
	groupPhotoFiles,
	type PhotoAsset as GroupedPhotoAsset,
	type PhotoFrame as GroupedPhotoFrame,
	type PhotoGroup
} from './photo-group';
import type { OriginalWrite, ThumbnailWrite } from './library-service';
import type { StoredAsset, StoredFrame } from './library-schema';
import type { PostframeWorkerClient } from './worker-client';
import { defaultEditDocument } from './edit-document';
import { entityId } from './entity-id';
import type { ObjectUrlRegistry } from './object-url-registry';
import { photoMetadata } from './photo-exif';
import { captureLabel, groupLabel, storedMetadata, type Photo } from './photo-record';

export interface PhotoImport {
	photo: Photo;
	originals: OriginalWrite[];
	thumbnails: ThumbnailWrite[];
}

interface FrameImport {
	frame: StoredFrame;
	originals: OriginalWrite[];
	rawFile: File | null;
	displayFile: File | null;
}

export interface PhotoIngestHost {
	reportError(message: string): void;
}

export class PhotoIngest {
	constructor(
		private readonly workerClient: PostframeWorkerClient | null,
		private readonly rawExtensions: ReadonlySet<string>,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly host: PhotoIngestHost
	) {}

	async photosFromFiles(files: File[]) {
		const grouping = groupPhotoFiles(files, this.rawExtensions);
		const imported: PhotoImport[] = [];
		const contentHashes = new Map<string, string>();
		if (grouping.rejectedFiles[0]) {
			this.host.reportError(`${grouping.rejectedFiles[0].name}: unsupported photo format`);
		}
		for (const [assetKey, file] of grouping.filesByAssetKey) {
			contentHashes.set(assetKey, await fileContentHash(file));
		}

		for (const group of grouping.groups) {
			try {
				imported.push(await this.photoFromGroup(group, grouping.filesByAssetKey, contentHashes));
			} catch (error) {
				const name = firstGroupedAsset(group)?.name ?? 'photo';
				const reason = error instanceof Error ? error.message : 'unsupported photo';
				this.host.reportError(`${name}: ${reason}`);
			}
		}

		return imported;
	}

	private async photoFromGroup(
		group: PhotoGroup,
		filesByAssetKey: ReadonlyMap<string, File>,
		contentHashes: ReadonlyMap<string, string>
	): Promise<PhotoImport> {
		const importedFrames = groupedFrames(group).map(({ photo, filenameExposureHint }) =>
			importFrame(photo, filenameExposureHint, filesByAssetKey, contentHashes)
		);
		const selectedFrame = importedFrames[primaryFrameIndex(group)];
		if (!selectedFrame) throw new Error('photo group has no frames');

		const rawFrames = importedFrames.filter(
			(frame): frame is FrameImport & { rawFile: File } => frame.rawFile !== null
		);
		const metadataFrame = selectedFrame.rawFile ? selectedFrame : rawFrames[0];
		let inspection: Awaited<ReturnType<PostframeWorkerClient['inspectRaw']>> | null = null;

		for (const frame of rawFrames) {
			if (!this.workerClient) throw new Error('RAW decoder is unavailable');
			const bytes = await frame.rawFile.arrayBuffer();
			if (frame === metadataFrame) inspection = await this.workerClient.inspectRaw(bytes);
			else await this.workerClient.validateRaw(bytes);
		}

		const photoId = entityId('photo');
		const selectedAsset = selectedFrame.frame.display ?? selectedFrame.frame.raw;
		if (!selectedAsset) throw new Error('photo frame has no source');
		let src: string | null = null;
		let thumbnailStorageName: string | null = null;
		const thumbnails: ThumbnailWrite[] = [];
		let displayDimensions: { width: number; height: number } | null = null;

		if (selectedFrame.displayFile) {
			const thumbnail = await createDisplayThumbnail(selectedFrame.displayFile);
			src = URL.createObjectURL(thumbnail.blob);
			displayDimensions = { width: thumbnail.width, height: thumbnail.height };
			thumbnailStorageName = `${photoId}.jpg`;
			thumbnails.push({ storageName: thumbnailStorageName, blob: thumbnail.blob });
		} else if (inspection) {
			const blob = new Blob([inspection.thumbnailJpeg], { type: 'image/jpeg' });
			src = URL.createObjectURL(blob);
			thumbnailStorageName = `${photoId}.jpg`;
			thumbnails.push({ storageName: thumbnailStorageName, blob });
		}
		if (src) this.objectUrls.add(src);

		const dimensions = inspection?.metadata ?? displayDimensions;
		const metadata = inspection
			? storedMetadata(inspection.metadata)
			: selectedFrame.displayFile
				? await photoMetadata(selectedFrame.displayFile)
				: null;
		const frameAssets = importedFrames.flatMap(({ frame }) =>
			[frame.raw, frame.display].filter((asset): asset is StoredAsset => asset !== null)
		);
		const photo = {
			id: photoId,
			name: selectedAsset.name,
			extension: groupLabel(group.kind, selectedFrame.frame, importedFrames.length),
			src,
			kind: group.kind,
			frames: importedFrames.map(({ frame }) => frame),
			bracketDetection: group.kind === 'bracket' ? group.detection : null,
			thumbnailStorageName,
			metadata,
			size: frameAssets.reduce((total, asset) => total + asset.source.size, 0),
			width: dimensions?.width ?? null,
			height: dimensions?.height ?? null,
			captured: captureLabel(metadata?.capturedAt, selectedAsset.source.lastModified),
			importedAt: Date.now(),
			rating: 0,
			flagged: false,
			rejected: false,
			colorLabel: 'none',
			stackId: null,
			edit: defaultEditDocument(photoId)
		} satisfies Photo;

		return {
			photo,
			originals: importedFrames.flatMap(({ originals }) => originals),
			thumbnails
		};
	}
}

function importFrame(
	frame: GroupedPhotoFrame,
	filenameExposureHint: number | null,
	filesByAssetKey: ReadonlyMap<string, File>,
	contentHashes: ReadonlyMap<string, string>
): FrameImport {
	const raw = frame.kind === 'raw' || frame.kind === 'raw-pair' ? frame.raw : null;
	const display = frame.kind === 'display' || frame.kind === 'raw-pair' ? frame.display : null;
	const rawImport = raw ? importedAsset(raw, filesByAssetKey, contentHashes) : null;
	const displayImport = display ? importedAsset(display, filesByAssetKey, contentHashes) : null;

	return {
		frame: {
			raw: rawImport?.asset ?? null,
			display: displayImport?.asset ?? null,
			filenameExposureHint
		},
		originals: [rawImport?.original, displayImport?.original].filter(
			(original): original is OriginalWrite => original !== undefined
		),
		rawFile: rawImport?.file ?? null,
		displayFile: displayImport?.file ?? null
	};
}

function groupedFrames(group: PhotoGroup) {
	return group.kind === 'bracket'
		? group.frames.map(({ photo, filenameExposureHint }) => ({ photo, filenameExposureHint }))
		: [{ photo: group, filenameExposureHint: null }];
}

function primaryFrameIndex(group: PhotoGroup) {
	if (group.kind !== 'bracket') return 0;
	const neutral = group.frames.findIndex(({ filenameExposureHint }) => filenameExposureHint === 0);
	return neutral >= 0 ? neutral : Math.floor(group.frames.length / 2);
}

function firstGroupedAsset(group: PhotoGroup) {
	const frame = groupedFrames(group)[0]?.photo;
	if (!frame) return null;
	return frame.kind === 'display' ? frame.display : frame.raw;
}

function importedAsset(
	asset: GroupedPhotoAsset,
	filesByAssetKey: ReadonlyMap<string, File>,
	contentHashes: ReadonlyMap<string, string>
): { asset: StoredAsset; original: OriginalWrite; file: File } {
	const file = filesByAssetKey.get(asset.key);
	if (!file) throw new Error(`${asset.name} is unavailable`);
	const contentHash = contentHashes.get(asset.key);
	if (!contentHash) throw new Error(`${asset.name} has no content identity`);
	const assetId = entityId('asset');
	const stored = {
		id: assetId,
		storageName: `${assetId}.${asset.source.format}`,
		name: asset.name,
		contentHash,
		source: { ...asset.source }
	} satisfies StoredAsset;
	return { asset: stored, original: { storageName: stored.storageName, file }, file };
}

async function fileContentHash(file: File) {
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createDisplayThumbnail(file: File) {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		const longestSide = Math.max(bitmap.width, bitmap.height);
		const scale = Math.min(1, 640 / longestSide);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Unable to create thumbnail canvas');
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('Unable to encode thumbnail'))),
				'image/jpeg',
				0.84
			)
		);
		return { blob, width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
}
