import {
	SMART_MASK_PACK,
	smartMaskStrokeSchema,
	type SmartMaskProgress,
	type SmartMaskRaster,
	type SmartMaskRequest,
	type SmartMaskResponse,
	type SmartMaskStroke
} from './smart-mask.ts';

type Completion = Exclude<SmartMaskResponse, { type: 'progress' | 'error' }>;
type CompletionType = Completion['type'];
type CompletionOf<Type extends CompletionType> = Extract<Completion, { type: Type }>;

interface PendingRequest {
	expected: CompletionType;
	resolve: (response: Completion) => void;
	reject: (error: Error) => void;
}

type WorkerFactory = () => Worker;
type ProgressListener = (progress: SmartMaskProgress) => void;

export class SmartMaskClient {
	readonly modelVersion = SMART_MASK_PACK.version;
	private worker: Worker;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly progressListeners = new Set<ProgressListener>();
	private nextRequestId = 1;
	private destroyed = false;
	private readonly workerFactory: WorkerFactory;

	constructor(workerFactory: WorkerFactory = createWorker) {
		this.workerFactory = workerFactory;
		this.worker = workerFactory();
		this.attach();
	}

	async prepare(photoId: string, image: Blob) {
		return this.send((id) => ({ id, type: 'prepare', photoId, image }), 'prepared');
	}

	async selectObject(photoId: string, selectionId: string, strokes: SmartMaskStroke[]) {
		const parsed = strokes.map((stroke) => smartMaskStrokeSchema.parse(stroke));
		const response = await this.send(
			(id) => ({ id, type: 'object', photoId, selectionId, strokes: parsed }),
			'mask'
		);
		return raster(response);
	}

	async selectSubject(photoId: string) {
		const response = await this.send((id) => ({ id, type: 'subject', photoId }), 'mask');
		return raster(response);
	}

	onProgress(listener: ProgressListener) {
		this.progressListeners.add(listener);
		return () => this.progressListeners.delete(listener);
	}

	restart(reason = 'Smart mask document changed') {
		if (this.destroyed) return;
		this.detach();
		this.worker.terminate();
		this.rejectPending(new Error(reason));
		this.worker = this.workerFactory();
		this.attach();
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.detach();
		this.worker.terminate();
		this.rejectPending(new Error('Smart mask worker closed'));
		this.progressListeners.clear();
	}

	private send<Type extends CompletionType>(
		request: (id: number) => SmartMaskRequest,
		expected: Type
	): Promise<CompletionOf<Type>> {
		if (this.destroyed) return Promise.reject(new Error('Smart mask worker closed'));
		const id = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				expected,
				resolve: (response) => resolve(response as CompletionOf<Type>),
				reject
			});
			this.worker.postMessage(request(id));
		});
	}

	private handleMessage = (event: MessageEvent<SmartMaskResponse>) => {
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

	private handleError = (event: ErrorEvent) => {
		this.rejectPending(new Error(event.message || 'Smart mask worker failed'));
	};

	private attach() {
		this.worker.addEventListener('message', this.handleMessage);
		this.worker.addEventListener('error', this.handleError);
	}

	private detach() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleError);
	}

	private rejectPending(error: Error) {
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}
}

function raster(response: Extract<SmartMaskResponse, { type: 'mask' }>): SmartMaskRaster {
	return {
		width: response.width,
		height: response.height,
		alpha: new Uint8Array(response.alpha)
	};
}

function createWorker() {
	return new Worker(new URL('./smart-mask.worker.ts', import.meta.url), { type: 'module' });
}
