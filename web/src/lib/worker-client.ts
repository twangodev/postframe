import type {
	DevelopedMaskInput,
	FileSource,
	MaskEdgeInput,
	RangeComponentInput,
	RawFrameHandleInput,
	RenderPerformanceMeasurement,
	RenderTileRequest,
	Request,
	Response,
	SourceImage,
	WhiteBalanceSample
} from './worker';
import { imageScopeFromTransfer } from './image-scope.ts';
import {
	cloneDevelopSettings,
	cloneMaskAdjustments,
	type DevelopSettings
} from './develop-settings.ts';
import { cloneCrop, type NormalizedCrop } from './edit-document.ts';
import type { ExportGeometry, ExportProgress } from './export.ts';
import {
	RenderPerformanceRecorder,
	type RenderPerformanceControls,
	type RenderRuntimeSummary
} from './render-performance.ts';

type ProgressResponse = Extract<Response, { type: 'progress' }>;
type ExportProgressResponse = Extract<Response, { type: 'export-progress' }>;
type ErrorResponse = Extract<Response, { type: 'error' }>;
type CompletionResponse = Exclude<
	Response,
	ProgressResponse | ExportProgressResponse | ErrorResponse
>;
type CompletionType = CompletionResponse['type'];
type CompletionOf<Type extends CompletionType> = Extract<CompletionResponse, { type: Type }>;

interface PendingRequest {
	expected: CompletionType;
	resolve: (response: CompletionResponse) => void;
	reject: (error: Error) => void;
	cleanup?: () => void;
	onExportProgress?: (progress: ExportProgress) => void;
}

export interface ExportPhotoRequest {
	adjustments: DevelopSettings;
	masks: DevelopedMaskInput[];
	geometry: ExportGeometry;
	quality: number;
}

interface PreviewWaiter {
	resolve: (preview: RenderedPreview) => void;
	reject: (error: Error) => void;
}

interface QueuedPreview {
	adjustments: DevelopSettings;
	crop: NormalizedCrop | null;
	tone: boolean;
	waiters: PreviewWaiter[];
}

interface RenderedPreview {
	image: ArrayBuffer;
	mediaType: 'image/jpeg' | 'image/png';
}

export type ProgressListener = (progress: ProgressResponse) => void;
export type PerformanceListener = (measurement: RenderPerformanceMeasurement) => void;

type WorkerFactory = () => Worker;

export class PostframeWorkerClient {
	private worker: Worker;
	private readonly workerFactory: WorkerFactory;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly progressListeners = new Set<ProgressListener>();
	private readonly performanceListeners = new Set<PerformanceListener>();
	private readonly storageListeners = new Set<() => void>();
	private readonly performanceRecorder = new RenderPerformanceRecorder();
	private performanceControls: RenderPerformanceControls | null = null;
	private renderRuntime: RenderRuntimeSummary | null = null;
	private nextRequestId = 1;
	private destroyed = false;
	private previewInFlight = false;
	private queuedPreview: QueuedPreview | null = null;

	constructor(workerFactory: WorkerFactory = createWorker) {
		this.workerFactory = workerFactory;
		this.worker = this.workerFactory();
		this.attachWorker();
		this.installPerformanceControls();
	}

	async capabilities() {
		const response = await this.send(
			(id) => ({
				id,
				type: 'capabilities',
				...(performanceRequested() ? { performance: true } : {})
			}),
			'capabilities'
		);
		this.renderRuntime = { threaded: response.threaded, threadCount: response.threadCount };
		return response;
	}

	async validateRaw(raw: ArrayBuffer) {
		await this.send((id) => ({ id, type: 'validate', raw }), 'validated', [raw]);
	}

	async inspectRaw(raw: ArrayBuffer, maxDimension = 768) {
		const response = await this.send(
			(id) => ({ id, type: 'inspect', raw, maxDimension }),
			'inspected',
			[raw]
		);
		return response.inspection;
	}

	async openRawDocument(
		frames: RawFrameHandleInput[],
		cache: FileSystemFileHandle,
		maxDimension: number,
		adjustments: DevelopSettings,
		crop: NormalizedCrop | null
	) {
		const response = await this.send(
			(id) => ({
				id,
				type: 'open-raw',
				frames,
				cache,
				maxDimension,
				adjustments: cloneDevelopSettings(adjustments),
				crop: cloneCrop(crop)
			}),
			'opened'
		);
		return openedDocument(response);
	}

	async openDisplayDocument(
		source: FileSource | FileSystemFileHandle,
		maxDimension: number,
		adjustments: DevelopSettings,
		crop: NormalizedCrop | null
	) {
		const response = await this.send(
			(id) => ({
				id,
				type: 'open-display',
				source: 'getFile' in source ? { kind: 'handle', handle: source } : source,
				maxDimension,
				adjustments: cloneDevelopSettings(adjustments),
				crop: cloneCrop(crop)
			}),
			'opened'
		);
		return openedDocument(response);
	}

	async renderTile(tile: RenderTileRequest, signal?: AbortSignal) {
		const request = {
			...tile,
			adjustments: cloneDevelopSettings(tile.adjustments),
			crop: cloneCrop(tile.crop),
			...(tile.clipping ? { clipping: { ...tile.clipping } } : {})
		};
		const response = await this.send(
			(id) => ({ id, type: 'tile', ...request }),
			'tile',
			[],
			signal
		);
		return response.bitmap;
	}

	async setMasks(masks: DevelopedMaskInput[]) {
		const copies = masks.map(copyDevelopedMask);
		await this.send(
			(id) => ({ id, type: 'set-masks', masks: copies }),
			'masks-set',
			copies.map(({ alpha }) => alpha)
		);
	}

	async setCameraLook(amount: number) {
		await this.send((id) => ({ id, type: 'camera-look', amount }), 'camera-look-set');
	}

	async adjustMask(mask: MaskEdgeInput) {
		const alpha = mask.alpha.slice(0);
		const response = await this.send(
			(id) => ({
				id,
				type: 'adjust-mask',
				width: mask.width,
				height: mask.height,
				alpha,
				edge: { ...mask.edge }
			}),
			'mask-adjusted',
			[alpha]
		);
		return new Uint8Array(response.alpha);
	}

	preview(adjustments: DevelopSettings, crop: NormalizedCrop | null, tone: boolean) {
		return new Promise<RenderedPreview>((resolve, reject) => {
			if (this.destroyed) {
				reject(new Error('Postframe worker closed'));
				return;
			}
			const waiter = { resolve, reject };
			if (this.queuedPreview) {
				this.queuedPreview.adjustments = cloneDevelopSettings(adjustments);
				this.queuedPreview.crop = cloneCrop(crop);
				this.queuedPreview.tone = tone;
				this.queuedPreview.waiters.push(waiter);
			} else {
				this.queuedPreview = {
					adjustments: cloneDevelopSettings(adjustments),
					crop: cloneCrop(crop),
					tone,
					waiters: [waiter]
				};
			}
			this.pumpPreview();
		});
	}

	async scope(
		adjustments: DevelopSettings,
		crop: NormalizedCrop | null,
		tone: boolean,
		sampleTarget: number
	) {
		const response = await this.send(
			(id) => ({
				id,
				type: 'scope',
				adjustments: cloneDevelopSettings(adjustments),
				crop: cloneCrop(crop),
				tone,
				sampleTarget
			}),
			'scope'
		);
		return imageScopeFromTransfer(response.scope);
	}

	async ultraPreview() {
		const response = await this.send((id) => ({ id, type: 'ultra' }), 'ultra');
		return response.jpeg;
	}

	async sourceImage(maxDimension: number): Promise<SourceImage> {
		const response = await this.send(
			(id) => ({ id, type: 'source-image', maxDimension }),
			'source-image'
		);
		return {
			width: response.width,
			height: response.height,
			rgba: new Uint8ClampedArray(response.rgba)
		};
	}

	async rasterizeRange(
		component: RangeComponentInput,
		maxDimension: number
	): Promise<{ width: number; height: number; alpha: Uint8Array }> {
		const response = await this.send(
			(id) => ({
				id,
				type: 'rasterize-range',
				component: copyRangeComponent(component),
				maxDimension
			}),
			'range-rasterized'
		);
		return {
			width: response.width,
			height: response.height,
			alpha: new Uint8Array(response.alpha)
		};
	}

	async autoBalance(sample?: WhiteBalanceSample) {
		const response = await this.send(
			(id) => ({ id, type: 'auto-balance', ...(sample ? { sample: { ...sample } } : {}) }),
			'auto-balance'
		);
		return { temperature: response.temperature, tint: response.tint };
	}

	async autoTone() {
		const response = await this.send((id) => ({ id, type: 'auto-tone' }), 'auto-tone');
		return { ...response.light };
	}

	async exportPhoto(request: ExportPhotoRequest, onProgress?: (progress: ExportProgress) => void) {
		const masks = request.masks.map(copyDevelopedMask);
		const response = await this.send(
			(id) => ({
				id,
				type: 'export',
				adjustments: cloneDevelopSettings(request.adjustments),
				masks,
				geometry: {
					...request.geometry,
					crop: request.geometry.crop ? { ...request.geometry.crop } : null
				},
				quality: request.quality
			}),
			'export',
			masks.map(({ alpha }) => alpha),
			undefined,
			onProgress
		);
		return response.jpeg;
	}

	async closeDocument() {
		await this.send((id) => ({ id, type: 'close' }), 'closed');
	}

	onProgress(listener: ProgressListener) {
		this.progressListeners.add(listener);
		return () => this.progressListeners.delete(listener);
	}

	/** Fires after the worker writes to storage on its own, such as a render cache. */
	onStorageWritten(listener: () => void) {
		this.storageListeners.add(listener);
		return () => this.storageListeners.delete(listener);
	}

	onPerformance(listener: PerformanceListener) {
		this.performanceListeners.add(listener);
		return () => this.performanceListeners.delete(listener);
	}

	performanceReport = () => this.performanceRecorder.snapshot(this.renderRuntime);

	clearPerformanceReport = () => this.performanceRecorder.clear();

	restart(reason = 'Postframe worker restarted') {
		if (this.destroyed) return;
		this.detachWorker();
		this.worker.terminate();
		this.rejectPending(new Error(reason));
		this.rejectQueuedPreview(new Error(reason));
		this.worker = this.workerFactory();
		this.attachWorker();
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.detachWorker();
		this.worker.terminate();
		this.rejectPending(new Error('Postframe worker closed'));
		this.rejectQueuedPreview(new Error('Postframe worker closed'));
		this.progressListeners.clear();
		this.performanceListeners.clear();
		if (
			this.performanceControls &&
			typeof window !== 'undefined' &&
			window.__postframePerformance === this.performanceControls
		) {
			delete window.__postframePerformance;
		}
		this.performanceControls = null;
	}

	private send<Type extends CompletionType>(
		request: (id: number) => Request,
		expected: Type,
		transfer: Transferable[] = [],
		signal?: AbortSignal,
		onExportProgress?: (progress: ExportProgress) => void
	): Promise<CompletionOf<Type>> {
		if (this.destroyed) return Promise.reject(new Error('Postframe worker closed'));
		if (signal?.aborted) return Promise.reject(new Error('Tile rendering cancelled'));
		const id = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			const pending: PendingRequest = {
				expected,
				resolve: (response) => resolve(response as CompletionOf<Type>),
				reject,
				onExportProgress
			};
			if (signal) {
				const cancel = () => {
					if (!this.pending.delete(id)) return;
					pending.cleanup?.();
					reject(new Error('Tile rendering cancelled'));
				};
				signal.addEventListener('abort', cancel, { once: true });
				pending.cleanup = () => signal.removeEventListener('abort', cancel);
			}
			this.pending.set(id, pending);
			try {
				this.worker.postMessage(request(id), transfer);
			} catch (error) {
				this.pending.delete(id);
				pending.cleanup?.();
				reject(error instanceof Error ? error : new Error('Unable to message Postframe worker'));
			}
		});
	}

	private pumpPreview() {
		if (this.previewInFlight || !this.queuedPreview) return;
		const preview = this.queuedPreview;
		this.queuedPreview = null;
		this.previewInFlight = true;
		void this.send(
			(id) => ({
				id,
				type: 'preview',
				adjustments: preview.adjustments,
				crop: preview.crop,
				tone: preview.tone
			}),
			'preview'
		)
			.then((response) => {
				const rendered = {
					image: response.image,
					mediaType: response.mediaType
				};
				for (const waiter of preview.waiters) waiter.resolve(rendered);
			})
			.catch((error: unknown) => {
				const reason = error instanceof Error ? error : new Error('Unable to render preview');
				for (const waiter of preview.waiters) waiter.reject(reason);
			})
			.finally(() => {
				this.previewInFlight = false;
				this.pumpPreview();
			});
	}

	private handleMessage = (event: MessageEvent<Response>) => {
		const response = event.data;
		if (response.type === 'performance') {
			this.recordPerformance(response.measurement);
			for (const listener of this.performanceListeners) listener(response.measurement);
			return;
		}
		if (response.type === 'progress') {
			for (const listener of this.progressListeners) listener(response);
			return;
		}
		if (response.type === 'storage-written') {
			for (const listener of this.storageListeners) listener();
			return;
		}
		if (response.type === 'export-progress') {
			this.pending.get(response.id)?.onExportProgress?.({
				phase: response.phase,
				completed: response.completed,
				total: response.total
			});
			return;
		}

		const pending = this.pending.get(response.id);
		if (!pending) {
			if (response.type === 'tile') response.bitmap.close();
			return;
		}
		this.pending.delete(response.id);
		pending.cleanup?.();

		if (response.type === 'error') {
			pending.reject(new Error(response.message));
			return;
		}
		if (response.type !== pending.expected) {
			pending.reject(new Error(`Expected ${pending.expected}, received ${response.type}`));
			return;
		}
		pending.resolve(response);
	};

	private recordPerformance(measurement: RenderPerformanceMeasurement) {
		this.performanceRecorder.record(measurement);
		if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
		performance.measure(`postframe:${measurement.stage}`, {
			start: Math.max(0, performance.now() - measurement.durationMs),
			duration: measurement.durationMs,
			detail: measurement.detail
		});
	}

	private handleWorkerError = (event: ErrorEvent) => {
		this.rejectPending(new Error(event.message || 'Postframe worker failed'));
	};

	private attachWorker() {
		this.worker.addEventListener('message', this.handleMessage);
		this.worker.addEventListener('error', this.handleWorkerError);
	}

	private installPerformanceControls() {
		if (!performanceRequested() || typeof window === 'undefined') return;
		this.performanceControls = {
			snapshot: this.performanceReport,
			clear: this.clearPerformanceReport
		};
		window.__postframePerformance = this.performanceControls;
	}

	private detachWorker() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleWorkerError);
	}

	private rejectPending(error: Error) {
		for (const pending of this.pending.values()) {
			pending.cleanup?.();
			pending.reject(error);
		}
		this.pending.clear();
	}

	private rejectQueuedPreview(error: Error) {
		if (!this.queuedPreview) return;
		for (const waiter of this.queuedPreview.waiters) waiter.reject(error);
		this.queuedPreview = null;
	}
}

function copyRangeComponent(component: RangeComponentInput): RangeComponentInput {
	return component.type === 'luminance-range'
		? { type: component.type, range: { ...component.range } }
		: { type: component.type, range: { ...component.range } };
}

function copyDevelopedMask(mask: DevelopedMaskInput): DevelopedMaskInput {
	return {
		...mask,
		edge: { ...mask.edge },
		settings: cloneMaskAdjustments(mask.settings),
		alpha: mask.alpha.slice(0)
	};
}

function createWorker() {
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function performanceRequested() {
	return typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
}

function openedDocument(response: Extract<Response, { type: 'opened' }>) {
	return {
		image: response.image,
		mediaType: response.mediaType,
		scope: imageScopeFromTransfer(response.scope),
		boostStops: response.boostStops,
		width: response.width,
		height: response.height
	};
}
