import type { RawFrameHandleInput, RenderTileRequest, Request, Response } from './worker';

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

export type ProgressListener = (progress: ProgressResponse) => void;

type WorkerFactory = () => Worker;

export class PostframeWorkerClient {
	private worker: Worker;
	private readonly workerFactory: WorkerFactory;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly progressListeners = new Set<ProgressListener>();
	private nextRequestId = 1;
	private destroyed = false;

	constructor(
		workerFactory: WorkerFactory = () =>
			new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
	) {
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

	async openDocument(frames: RawFrameHandleInput[], maxDimension: number, ev: number) {
		const response = await this.send(
			(id) => ({ id, type: 'open', frames, maxDimension, ev }),
			'opened'
		);
		return {
			jpeg: response.jpeg,
			boostStops: response.boostStops,
			width: response.width,
			height: response.height
		};
	}

	async renderTile(tile: RenderTileRequest) {
		const response = await this.send((id) => ({ id, type: 'tile', ...tile }), 'tile');
		return response.png;
	}

	async preview(ev: number, tone: boolean) {
		const response = await this.send((id) => ({ id, type: 'preview', ev, tone }), 'preview');
		return response.jpeg;
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

	restart(reason = 'Postframe worker restarted') {
		if (this.destroyed) return;
		this.detachWorker();
		this.worker.terminate();
		this.rejectPending(new Error(reason));
		this.worker = this.workerFactory();
		this.attachWorker();
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.detachWorker();
		this.worker.terminate();
		this.rejectPending(new Error('Postframe worker closed'));
		this.progressListeners.clear();
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

	private handleMessage = (event: MessageEvent<Response>) => {
		const response = event.data;
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
}
