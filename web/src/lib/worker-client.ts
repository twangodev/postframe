import type { RawFrameInput, Request, Response } from './worker';

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

export class PostframeWorkerClient {
	private readonly worker: Worker;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly progressListeners = new Set<ProgressListener>();
	private nextRequestId = 1;

	constructor(worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
		this.worker = worker;
		this.worker.addEventListener('message', this.handleMessage);
		this.worker.addEventListener('error', this.handleWorkerError);
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

	async load(frames: RawFrameInput[]) {
		const transfer = frames.flatMap((frame) =>
			frame.jpeg ? [frame.raw, frame.jpeg] : [frame.raw]
		);
		const response = await this.send((id) => ({ id, type: 'load', frames }), 'merged', transfer);
		return response.boostStops;
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

	onProgress(listener: ProgressListener) {
		this.progressListeners.add(listener);
		return () => this.progressListeners.delete(listener);
	}

	destroy() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleWorkerError);
		this.worker.terminate();
		this.rejectPending(new Error('Postframe worker closed'));
		this.progressListeners.clear();
	}

	private send<Type extends CompletionType>(
		request: (id: number) => Request,
		expected: Type,
		transfer: Transferable[] = []
	): Promise<CompletionOf<Type>> {
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

	private rejectPending(error: Error) {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}
