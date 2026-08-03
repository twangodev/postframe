import type {
	RawFrameHandleInput,
	RenderPerformanceMeasurement,
	RenderTileRequest,
	Request,
	Response
} from './worker';
import { imageScopeFromTransfer } from './image-scope.ts';
import type { LightSettings } from './develop-settings.ts';

type ProgressResponse = Extract<Response, { type: 'progress' }>;
type ErrorResponse = Extract<Response, { type: 'error' }>;
type CompletionResponse = Exclude<Response, ProgressResponse | ErrorResponse>;
type CompletionType = CompletionResponse['type'];
type CompletionOf<Type extends CompletionType> = Extract<CompletionResponse, { type: Type }>;

interface PendingRequest {
	expected: CompletionType;
	resolve: (response: CompletionResponse) => void;
	reject: (error: Error) => void;
}

interface PreviewWaiter {
	resolve: (preview: RenderedPreview) => void;
	reject: (error: Error) => void;
}

interface QueuedPreview {
	settings: LightSettings;
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
	private nextRequestId = 1;
	private destroyed = false;
	private previewInFlight = false;
	private queuedPreview: QueuedPreview | null = null;

	constructor(workerFactory: WorkerFactory = createWorker) {
		this.workerFactory = workerFactory;
		this.worker = this.workerFactory();
		this.attachWorker();
	}

	async capabilities() {
		return this.send((id) => ({ id, type: 'capabilities' }), 'capabilities');
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
		maxDimension: number,
		settings: LightSettings
	) {
		const response = await this.send(
			(id) => ({ id, type: 'open-raw', frames, maxDimension, settings }),
			'opened'
		);
		return openedDocument(response);
	}

	async openDisplayDocument(
		source: FileSystemFileHandle,
		maxDimension: number,
		settings: LightSettings
	) {
		const response = await this.send(
			(id) => ({ id, type: 'open-display', source, maxDimension, settings }),
			'opened'
		);
		return openedDocument(response);
	}

	async renderTile(tile: RenderTileRequest) {
		const request = { ...tile, settings: { ...tile.settings } };
		const response = await this.send((id) => ({ id, type: 'tile', ...request }), 'tile');
		return response.bitmap;
	}

	preview(settings: LightSettings, tone: boolean) {
		return new Promise<RenderedPreview>((resolve, reject) => {
			if (this.destroyed) {
				reject(new Error('Postframe worker closed'));
				return;
			}
			const waiter = { resolve, reject };
			if (this.queuedPreview) {
				this.queuedPreview.settings = settings;
				this.queuedPreview.tone = tone;
				this.queuedPreview.waiters.push(waiter);
			} else {
				this.queuedPreview = { settings, tone, waiters: [waiter] };
			}
			this.pumpPreview();
		});
	}

	async scope(settings: LightSettings, tone: boolean, sampleTarget: number) {
		const response = await this.send(
			(id) => ({ id, type: 'scope', settings: { ...settings }, tone, sampleTarget }),
			'scope'
		);
		return imageScopeFromTransfer(response.scope);
	}

	async ultraPreview() {
		const response = await this.send((id) => ({ id, type: 'ultra' }), 'ultra');
		return response.jpeg;
	}

	async exportUltra() {
		const response = await this.send((id) => ({ id, type: 'export' }), 'export');
		return response.jpeg;
	}

	async closeDocument() {
		await this.send((id) => ({ id, type: 'close' }), 'closed');
	}

	onProgress(listener: ProgressListener) {
		this.progressListeners.add(listener);
		return () => this.progressListeners.delete(listener);
	}

	onPerformance(listener: PerformanceListener) {
		this.performanceListeners.add(listener);
		return () => this.performanceListeners.delete(listener);
	}

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
	}

	private send<Type extends CompletionType>(
		request: (id: number) => Request,
		expected: Type,
		transfer: Transferable[] = []
	): Promise<CompletionOf<Type>> {
		if (this.destroyed) return Promise.reject(new Error('Postframe worker closed'));
		const id = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				expected,
				resolve: (response) => resolve(response as CompletionOf<Type>),
				reject
			});
			try {
				this.worker.postMessage(request(id), transfer);
			} catch (error) {
				this.pending.delete(id);
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
			(id) => ({ id, type: 'preview', settings: preview.settings, tone: preview.tone }),
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

		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);

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

	private detachWorker() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleWorkerError);
	}

	private rejectPending(error: Error) {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private rejectQueuedPreview(error: Error) {
		if (!this.queuedPreview) return;
		for (const waiter of this.queuedPreview.waiters) waiter.reject(error);
		this.queuedPreview = null;
	}
}

function createWorker() {
	const url = new URL('./worker.ts', import.meta.url);
	if (
		import.meta.env.DEV &&
		typeof location !== 'undefined' &&
		new URLSearchParams(location.search).has('perf')
	) {
		url.searchParams.set('perf', '');
	}
	return new Worker(url, { type: 'module' });
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
