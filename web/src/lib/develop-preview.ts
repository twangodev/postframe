import type { ColorSettings, LightSettings } from './develop-settings';
import type { ImageScopeData } from './image-scope';
import type { ObjectUrlRegistry } from './object-url-registry';
import type { Photo } from './photo-record';
import type { PostframeWorkerClient } from './worker-client';

export type DevelopPreviewPhase = 'applying' | 'refining';

const INTERACTIVE_SCOPE_SAMPLE_TARGET = 150_000;
const COMMITTED_SCOPE_SAMPLE_TARGET = 750_000;
const INTERACTIVE_SCOPE_INTERVAL_MS = 125;

export interface DevelopPreviewHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	developPreview: { photoId: string; src: string | null; phase: DevelopPreviewPhase } | null;
	imageScope: ImageScopeData | null;
}

export class DevelopPreviewController {
	private previewTimer: ReturnType<typeof setTimeout> | null = null;
	private scopeTimer: ReturnType<typeof setTimeout> | null = null;
	private scopeRevision = 0;
	private lastScopeAt = 0;
	private previewRevision = 0;
	private previewUrl: string | null = null;
	private refinementRevision: number | null = null;

	constructor(
		private readonly workerClient: PostframeWorkerClient | null,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly host: DevelopPreviewHost
	) {}

	schedule(settings: LightSettings, color: ColorSettings) {
		this.clearPreviewTimer();
		this.show('applying');
		this.previewTimer = setTimeout(() => {
			this.previewTimer = null;
			this.request(settings, color, 'applying');
		}, 40);
	}

	request(settings: LightSettings, color: ColorSettings, phase: DevelopPreviewPhase) {
		this.clearPreviewTimer();
		if (!this.workerClient || !this.host.selectedPhoto || !this.host.canAdjustLight) return;
		const photoId = this.host.selectedPhoto.id;
		const revision = ++this.previewRevision;
		this.show(phase);
		void this.workerClient
			.preview(settings, color, true)
			.then((preview) => {
				if (revision !== this.previewRevision || this.host.selectedPhoto?.id !== photoId) return;
				const src = URL.createObjectURL(new Blob([preview.image], { type: preview.mediaType }));
				this.replaceUrl(src);
				this.host.developPreview = {
					photoId,
					src,
					phase: this.host.developPreview?.phase ?? phase
				};
				this.scheduleScope(settings, color, photoId, phase === 'refining');
			})
			.catch(() => {
				if (revision === this.previewRevision && this.refinementRevision === null) {
					this.release();
				}
			});
	}

	markRefining(revision: number) {
		this.refinementRevision = revision;
	}

	// Re-measures the scope at the committed settings after a preview that
	// never became a document change.
	refreshScope(settings: LightSettings, color: ColorSettings) {
		if (!this.workerClient || !this.host.selectedPhoto || !this.host.canAdjustLight) return;
		this.scheduleScope(settings, color, this.host.selectedPhoto.id, true);
	}

	settle(revision: number) {
		if (this.refinementRevision !== revision) return;
		this.refinementRevision = null;
		this.release();
	}

	release() {
		this.clearPreviewTimer();
		this.clearScopeTimer();
		this.previewRevision += 1;
		this.scopeRevision += 1;
		this.refinementRevision = null;
		if (this.previewUrl) this.objectUrls.revoke(this.previewUrl);
		this.previewUrl = null;
		this.host.developPreview = null;
	}

	private show(phase: DevelopPreviewPhase) {
		if (!this.host.selectedPhoto) return;
		this.host.developPreview = {
			photoId: this.host.selectedPhoto.id,
			src: this.previewUrl,
			phase
		};
	}

	private replaceUrl(src: string) {
		if (this.previewUrl) this.objectUrls.revoke(this.previewUrl);
		this.previewUrl = src;
		this.objectUrls.add(src);
	}

	private clearPreviewTimer() {
		if (this.previewTimer === null) return;
		clearTimeout(this.previewTimer);
		this.previewTimer = null;
	}

	private scheduleScope(
		settings: LightSettings,
		color: ColorSettings,
		photoId: string,
		committed: boolean
	) {
		this.clearScopeTimer();
		const revision = ++this.scopeRevision;
		const elapsed = Date.now() - this.lastScopeAt;
		const delay = committed ? 0 : Math.max(0, INTERACTIVE_SCOPE_INTERVAL_MS - elapsed);
		this.scopeTimer = setTimeout(() => {
			this.scopeTimer = null;
			this.lastScopeAt = Date.now();
			void this.workerClient
				?.scope(
					settings,
					color,
					true,
					committed ? COMMITTED_SCOPE_SAMPLE_TARGET : INTERACTIVE_SCOPE_SAMPLE_TARGET
				)
				.then((scope) => {
					if (revision !== this.scopeRevision || this.host.selectedPhoto?.id !== photoId) return;
					this.host.imageScope = scope;
				})
				.catch(() => {});
		}, delay);
	}

	private clearScopeTimer() {
		if (this.scopeTimer === null) return;
		clearTimeout(this.scopeTimer);
		this.scopeTimer = null;
	}
}
