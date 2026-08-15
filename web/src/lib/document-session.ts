import type { DevelopPhase, DevelopProgress, RawFrameHandleInput } from './worker';
import type { EditDocument } from './edit-document';
import type { ImageScopeData } from './image-scope';
import type { LibraryService } from './library-service';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskRasterPipeline, SelectedMaskRaster } from './mask-raster-pipeline';
import type { ObjectUrlRegistry } from './object-url-registry';
import { primaryStoredFrame, type Photo } from './photo-record';
import type { SmartMasking, SmartMaskStatus, SubjectChoices } from './smart-masking';
import type { PostframeWorkerClient } from './worker-client';
import type { WorkspacePersistence } from './workspace-persistence';

export type DocumentStatus =
	| { kind: 'idle' }
	| {
			kind: 'loading';
			photoId: string;
			phase: DevelopPhase;
			bytesRead: number;
			totalBytes: number;
			framesDecoded: number;
			totalFrames: number;
			activeFrame: number;
	  }
	| { kind: 'ready'; photoId: string; boostStops: number | null }
	| { kind: 'cancelled'; photoId: string }
	| { kind: 'error'; photoId: string; message: string };

export interface DocumentSessionHost {
	readonly mode: 'welcome' | 'organize' | 'edit';
	readonly photos: Photo[];
	documentStatus: DocumentStatus;
	editPreview: { src: string; width: number; height: number } | null;
	imageScope: ImageScopeData | null;
	selectedMaskRaster: SelectedMaskRaster | null;
	subjectChoices: SubjectChoices | null;
	smartMaskStatus: SmartMaskStatus;
	resetEditState(document: EditDocument): void;
}

export class DocumentSession {
	private revision = 0;
	private removeProgressListener: (() => void) | null = null;

	constructor(
		private readonly service: LibraryService | null,
		private readonly workerClient: PostframeWorkerClient | null,
		private readonly persistence: WorkspacePersistence,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly pipeline: MaskRasterPipeline,
		private readonly develop: DevelopPreviewController,
		private readonly smartMasks: SmartMasking,
		private readonly host: DocumentSessionHost
	) {
		this.removeProgressListener =
			this.workerClient?.onProgress((progress) => {
				if (this.host.documentStatus.kind !== 'loading') return;
				this.host.documentStatus = {
					...this.host.documentStatus,
					...developProgress(progress)
				};
			}) ?? null;
	}

	async open(photoId: string) {
		const photo = this.host.photos.find((candidate) => candidate.id === photoId);
		if (!photo || this.host.mode !== 'edit') return;
		this.host.resetEditState(photo.edit);

		const revision = ++this.revision;
		if (this.host.documentStatus.kind !== 'idle') {
			this.workerClient?.restart('Document changed');
		}
		this.releaseEditPreview();

		if (!this.workerClient) {
			this.host.documentStatus = { kind: 'error', photoId, message: 'Image worker is unavailable' };
			return;
		}

		this.host.documentStatus = {
			kind: 'loading',
			photoId,
			phase: 'reading',
			bytesRead: 0,
			totalBytes: 0,
			framesDecoded: 0,
			totalFrames: photo.frames.length,
			activeFrame: 1
		};

		try {
			await this.persistence.whenIdle();
			if (revision !== this.revision) return;
			if (photo.kind === 'display') {
				await this.openDisplay(photo, revision);
				return;
			}
			const frames = await this.frames(photo);
			const cache = await this.service!.renderCacheHandle(photo.id);
			if (revision !== this.revision) return;
			const result = await this.workerClient.openRawDocument(
				frames,
				cache,
				previewDimension(),
				photo.edit.adjustments.light
			);
			if (revision !== this.revision) return;
			await this.pipeline.installMaskCompositors(photo.edit, () => revision === this.revision);
			if (revision !== this.revision) return;
			this.install(photoId, result);
		} catch (error) {
			if (revision !== this.revision) return;
			this.host.documentStatus = {
				kind: 'error',
				photoId,
				message: error instanceof Error ? error.message : 'Unable to open document'
			};
		}
	}

	private async openDisplay(photo: Photo, revision: number) {
		const store = this.service;
		const display = primaryStoredFrame(photo).display;
		if (!store || !display) throw new Error('Display original is unavailable');
		const source = await store.originalHandle(display.storageName);
		if (revision !== this.revision) return;
		const result = await this.workerClient!.openDisplayDocument(
			source,
			previewDimension(),
			photo.edit.adjustments.light
		);
		if (revision !== this.revision) return;
		await this.pipeline.installMaskCompositors(photo.edit, () => revision === this.revision);
		if (revision !== this.revision) return;
		this.install(photo.id, result);
	}

	private install(
		photoId: string,
		result: Awaited<ReturnType<PostframeWorkerClient['openRawDocument']>>
	) {
		const src = URL.createObjectURL(new Blob([result.image], { type: result.mediaType }));
		this.objectUrls.add(src);
		this.host.editPreview = { src, width: result.width, height: result.height };
		this.host.imageScope = result.scope;
		this.host.documentStatus = { kind: 'ready', photoId, boostStops: result.boostStops };
	}

	private async frames(photo: Photo): Promise<RawFrameHandleInput[]> {
		const store = this.service;
		if (!store) throw new Error('RAW editing requires local OPFS storage');

		return Promise.all(
			photo.frames.map(async (frame) => {
				if (!frame.raw) throw new Error('Every bracket frame needs a RAW source');
				const raw = await store.originalHandle(frame.raw.storageName);
				const jpeg = frame.display
					? await store.originalHandle(frame.display.storageName)
					: undefined;
				return { raw, jpeg };
			})
		);
	}

	close() {
		this.revision += 1;
		this.smartMasks.invalidateSession();
		this.pipeline.invalidate();
		this.develop.release();
		const hadDocument = this.host.documentStatus.kind !== 'idle';
		this.releaseEditPreview();
		this.host.imageScope = null;
		this.host.selectedMaskRaster = null;
		this.host.subjectChoices = null;
		this.host.smartMaskStatus = { phase: 'idle', progress: null, detail: '', error: null };
		this.host.documentStatus = { kind: 'idle' };
		if (hadDocument) this.workerClient?.restart('Document closed');
	}

	cancel() {
		if (this.host.documentStatus.kind !== 'loading') return;
		const photoId = this.host.documentStatus.photoId;
		this.revision += 1;
		this.workerClient?.restart('Development cancelled');
		this.releaseEditPreview();
		this.host.documentStatus = { kind: 'cancelled', photoId };
	}

	invalidate() {
		this.revision += 1;
	}

	stopProgressTracking() {
		this.removeProgressListener?.();
		this.removeProgressListener = null;
	}

	private releaseEditPreview() {
		if (!this.host.editPreview) return;
		this.objectUrls.revoke(this.host.editPreview.src);
		this.host.editPreview = null;
	}
}

function previewDimension() {
	if (typeof window === 'undefined') return 2048;
	const longestSide = Math.max(window.innerWidth, window.innerHeight) * window.devicePixelRatio;
	return Math.round(Math.min(2560, Math.max(1024, longestSide)));
}

function developProgress(progress: DevelopProgress) {
	return {
		phase: progress.phase,
		bytesRead: progress.bytesRead,
		totalBytes: progress.totalBytes,
		framesDecoded: progress.framesDecoded,
		totalFrames: progress.totalFrames,
		activeFrame: progress.activeFrame
	};
}
