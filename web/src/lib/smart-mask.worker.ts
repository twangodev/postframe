import { reportError, reportUncaught } from './diagnostics.ts';
import { RawImage, env, pipeline, type ProgressInfo } from '@huggingface/transformers';
import { refineObjectMask, refinePaintedMask } from './mask-edge-refiner.ts';
import { OpfsModelCache } from './model-cache.ts';
import { alphaChannel } from './mask-raster.ts';
import { usableSam2Mask } from './sam2-candidates.ts';
import { skySegmentAlpha, type SkySegment } from './sky-matte.ts';
import { detectedSubjects, type RawDetection } from './subject-detection.ts';
import {
	Sam2ObjectRuntime,
	type Sam2ImageEmbedding,
	type Sam2Selection
} from './sam2-object-runtime.ts';
import {
	SMART_MASK_PACK,
	type SmartMaskDevice,
	type SmartMaskRequest,
	type SmartMaskResponse,
	type SmartMaskTransfer
} from './smart-mask.ts';
import { TransferRate } from './transfer-rate.ts';

type SubjectPipeline = Awaited<ReturnType<typeof pipeline<'background-removal'>>>;
type DetectorPipeline = Awaited<ReturnType<typeof pipeline<'object-detection'>>>;
type SkyPipeline = Awaited<ReturnType<typeof pipeline<'image-segmentation'>>>;

const DETECTION_THRESHOLD = 0.5;

interface PreparedImage {
	photoId: string;
	image: RawImage;
	embedding: Sam2ImageEmbedding | null;
	selection: { id: string; prompt: string; result: Sam2Selection } | null;
}

interface ModelSlot<Model> {
	model: Model | null;
	loading: Promise<void> | null;
	device: SmartMaskDevice | null;
}

const modelSlot = <Model>(): ModelSlot<Model> => ({ model: null, loading: null, device: null });

let preferredDevice: Promise<SmartMaskDevice> | null = null;
const objectSlot = modelSlot<Sam2ObjectRuntime>();
const subjectSlot = modelSlot<SubjectPipeline>();
const detectorSlot = modelSlot<DetectorPipeline>();
const skySlot = modelSlot<SkyPipeline>();
let prepared: PreparedImage | null = null;

env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = new OpfsModelCache();
env.remoteHost = import.meta.env.VITE_SMART_MASK_MODEL_HOST ?? SMART_MASK_PACK.modelHost;

const post = (message: SmartMaskResponse, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<SmartMaskRequest>) => {
	const request = event.data;
	try {
		switch (request.type) {
			case 'prepare':
				await prepare(request);
				break;
			case 'object':
				await selectObject(request);
				break;
			case 'subject':
				await selectSubject(request);
				break;
			case 'sky':
				await selectSky(request);
				break;
			case 'detect-subjects':
				await detectSubjectsInPhoto(request);
				break;
			case 'instance':
				await selectInstance(request);
				break;
			case 'refine-edge':
				refineEdge(request);
				break;
			case 'reset':
				resetPreparedImage();
				post({ id: request.id, type: 'reset' });
				break;
			case 'warmup':
				await warmup(request);
				break;
		}
	} catch (error) {
		post({ id: request.id, type: 'error', message: errorMessage(error) });
	}
};

async function prepare(request: Extract<SmartMaskRequest, { type: 'prepare' }>) {
	resetPreparedImage();
	postProgress(request.id, 'loading', null, 'reading photo');
	const image = await RawImage.fromBlob(request.image);
	prepared = { photoId: request.photoId, image, embedding: null, selection: null };
	postProgress(request.id, 'ready', 100, 'smart mask ready');
	post({
		id: request.id,
		type: 'prepared',
		modelVersion: SMART_MASK_PACK.version,
		device: objectSlot.device ?? (await detectPreferredDevice())
	});
}

async function warmup(request: Extract<SmartMaskRequest, { type: 'warmup' }>) {
	postProgress(request.id, 'loading', null, 'loading object model');
	await loadObjectModel(request.id);
	postProgress(request.id, 'loading', null, 'loading subject model');
	await loadSubjectModel(request.id);
	postProgress(request.id, 'loading', null, 'loading detection model');
	await loadDetectorModel(request.id);
	postProgress(request.id, 'loading', null, 'loading sky model');
	await loadSkyModel(request.id);
	postProgress(request.id, 'ready', 100, 'smart mask models ready');
	post({ id: request.id, type: 'warmed' });
}

async function selectObject(request: Extract<SmartMaskRequest, { type: 'object' }>) {
	const active = preparedImage(request.photoId);
	try {
		await selectObjectWithActiveDevice(request, active);
	} catch (error) {
		if (objectSlot.device === 'wasm') throw error;
		postProgress(request.id, 'loading', null, 'retrying with compatible runtime');
		await fallBackObjectModel(request.id, active);
		await selectObjectWithActiveDevice(request, active);
	}
}

async function selectObjectWithActiveDevice(
	request: Extract<SmartMaskRequest, { type: 'object' }>,
	active: PreparedImage
) {
	if (request.strokes.length === 0) throw new Error('Paint over an object before selecting it');
	postProgress(request.id, 'loading', null, 'loading object model');
	await loadObjectModel(request.id);
	if (!active.embedding) {
		postProgress(request.id, 'encoding', null, 'analyzing photo');
		active.embedding = await objectSlot.model!.encode(active.image);
	}

	postProgress(request.id, 'refining', null, 'finding object');
	const prompt = JSON.stringify(request.strokes);
	if (active.selection?.id !== request.selectionId || active.selection.prompt !== prompt) {
		active.selection = {
			id: request.selectionId,
			prompt,
			result: await objectSlot.model!.select(
				active.embedding,
				request.strokes,
				active.image.width,
				active.image.height
			)
		};
	}
	const viable = active.selection.result.candidates.filter((candidate) =>
		usableSam2Mask(candidate, active.selection!.result.prompts)
	);
	if (viable.length === 0) throw new Error('The object model returned an unusable mask');
	const index = positiveModulo(request.candidate, viable.length);
	const coarseAlpha = await objectSlot.model!.render(viable[index]!, active.embedding);
	postProgress(request.id, 'refining', null, 'refining object edges');
	const alpha = refineObjectMask(active.image, coarseAlpha);
	postMask(request.id, active.image.width, active.image.height, alpha, {
		index,
		count: viable.length
	});
	postProgress(request.id, 'ready', 100, 'smart mask ready');
}

async function detectSubjectsInPhoto(
	request: Extract<SmartMaskRequest, { type: 'detect-subjects' }>
) {
	const active = preparedImage(request.photoId);
	postProgress(request.id, 'loading', null, 'loading detection model');
	await loadDetectorModel(request.id);
	postProgress(request.id, 'refining', null, 'finding subjects');
	const detections = (await detectorSlot.model!(active.image, {
		threshold: DETECTION_THRESHOLD
	})) as RawDetection[];
	post({
		id: request.id,
		type: 'detections',
		modelVersion: SMART_MASK_PACK.version,
		subjects: detectedSubjects(detections, active.image.width, active.image.height)
	});
	postProgress(request.id, 'ready', 100, 'subjects ready');
}

async function selectInstance(request: Extract<SmartMaskRequest, { type: 'instance' }>) {
	const active = preparedImage(request.photoId);
	try {
		await selectInstanceWithActiveDevice(request, active);
	} catch (error) {
		if (objectSlot.device === 'wasm') throw error;
		postProgress(request.id, 'loading', null, 'retrying with compatible runtime');
		await fallBackObjectModel(request.id, active);
		await selectInstanceWithActiveDevice(request, active);
	}
}

async function selectInstanceWithActiveDevice(
	request: Extract<SmartMaskRequest, { type: 'instance' }>,
	active: PreparedImage
) {
	postProgress(request.id, 'loading', null, 'loading object model');
	await loadObjectModel(request.id);
	if (!active.embedding) {
		postProgress(request.id, 'encoding', null, 'analyzing photo');
		active.embedding = await objectSlot.model!.encode(active.image);
	}

	postProgress(request.id, 'refining', null, 'isolating subject');
	const selection = await objectSlot.model!.selectBox(
		active.embedding,
		request.box,
		active.image.width,
		active.image.height
	);
	const viable = selection.candidates.filter((candidate) =>
		usableSam2Mask(candidate, selection.prompts)
	);
	const candidates = viable.length > 0 ? viable : selection.candidates.slice(0, 1);
	if (candidates.length === 0) throw new Error('The object model returned an unusable mask');
	const index = positiveModulo(request.candidate, candidates.length);
	const coarseAlpha = await objectSlot.model!.render(candidates[index]!, active.embedding);
	postProgress(request.id, 'refining', null, 'refining subject edges');
	const alpha = refineObjectMask(active.image, coarseAlpha);
	postMask(request.id, active.image.width, active.image.height, alpha, {
		index,
		count: candidates.length
	});
	postProgress(request.id, 'ready', 100, 'smart mask ready');
}

async function selectSubject(request: Extract<SmartMaskRequest, { type: 'subject' }>) {
	const active = preparedImage(request.photoId);
	postProgress(request.id, 'loading', null, 'loading subject model');
	await loadSubjectModel(request.id);
	postProgress(request.id, 'refining', null, 'finding subject');
	const mask = await subjectSlot.model!(active.image);
	const alpha = alphaChannel(mask);
	postMask(request.id, mask.width, mask.height, alpha);
	postProgress(request.id, 'ready', 100, 'smart mask ready');
}

async function selectSky(request: Extract<SmartMaskRequest, { type: 'sky' }>) {
	const active = preparedImage(request.photoId);
	postProgress(request.id, 'loading', null, 'loading sky model');
	await loadSkyModel(request.id);
	postProgress(request.id, 'refining', null, 'finding sky');
	const segments = (await skySlot.model!(active.image)) as SkySegment[];
	const coarseAlpha = skySegmentAlpha(segments, active.image.width, active.image.height);
	if (!coarseAlpha) throw new Error('No sky was found in this photo');
	postProgress(request.id, 'refining', null, 'refining sky edges');
	postMask(
		request.id,
		active.image.width,
		active.image.height,
		skyEdges(active.image, coarseAlpha)
	);
	postProgress(request.id, 'ready', 100, 'smart mask ready');
}

function skyEdges(image: RawImage, coarseAlpha: Uint8Array) {
	try {
		return refineObjectMask(image, coarseAlpha);
	} catch {
		return coarseAlpha;
	}
}

function refineEdge(request: Extract<SmartMaskRequest, { type: 'refine-edge' }>) {
	const active = preparedImage(request.photoId);
	if (request.width !== active.image.width || request.height !== active.image.height) {
		throw new Error('Mask edge dimensions do not match the prepared photo');
	}
	postProgress(request.id, 'refining', null, 'refining painted edge');
	const alpha = refinePaintedMask(active.image, new Uint8Array(request.alpha), request.stroke);
	postMask(request.id, request.width, request.height, alpha);
	postProgress(request.id, 'ready', 100, 'mask edge ready');
}

async function loadModel<Model>(
	slot: ModelSlot<Model>,
	create: (device: SmartMaskDevice) => Promise<Model>
) {
	slot.loading ??= (async () => {
		slot.device ??= await detectPreferredDevice();
		try {
			slot.model = await create(slot.device);
		} catch (error) {
			if (slot.device === 'wasm') throw error;
			slot.device = 'wasm';
			slot.model = await create(slot.device);
		}
	})().catch((error) => {
		slot.loading = null;
		throw error;
	});
	await slot.loading;
}

const loadObjectModel = (requestId: number) =>
	loadModel(objectSlot, (device) =>
		Sam2ObjectRuntime.load(
			SMART_MASK_PACK.object,
			device,
			downloadReporter(requestId, 'object model')
		)
	);

const loadSubjectModel = (requestId: number) =>
	loadModel(subjectSlot, (device) =>
		pipeline('background-removal', SMART_MASK_PACK.subject.id, {
			...modelOptions(SMART_MASK_PACK.subject, device, requestId, 'subject model')
		})
	);

const loadDetectorModel = (requestId: number) =>
	loadModel(detectorSlot, (device) =>
		pipeline('object-detection', SMART_MASK_PACK.detector.id, {
			...modelOptions(SMART_MASK_PACK.detector, device, requestId, 'detection model')
		})
	);

const loadSkyModel = (requestId: number) =>
	loadModel(skySlot, (device) =>
		pipeline('image-segmentation', SMART_MASK_PACK.sky.id, {
			...modelOptions(SMART_MASK_PACK.sky, device, requestId, 'sky model'),
			// onnxruntime's layer-norm fusion rejects this fp16 export, so stay at basic optimization.
			session_options: { graphOptimizationLevel: 'basic' }
		})
	);

async function fallBackObjectModel(requestId: number, active: PreparedImage) {
	objectSlot.model?.disposeEmbedding(active.embedding);
	active.embedding = null;
	active.selection = null;
	await objectSlot.model?.dispose();
	objectSlot.model = null;
	objectSlot.loading = null;
	objectSlot.device = 'wasm';
	await loadObjectModel(requestId);
}

function modelOptions(
	model: (typeof SMART_MASK_PACK)['subject'],
	device: SmartMaskDevice,
	requestId: number,
	label: string
) {
	return {
		revision: model.revision,
		dtype: model.dtype,
		device,
		progress_callback: downloadReporter(requestId, label)
	} as const;
}

function downloadReporter(requestId: number, label: string) {
	const rate = new TransferRate();
	return (progress: ProgressInfo) => {
		if (progress.status !== 'progress_total') return;
		const transfer = rate.sample(progress.loaded, progress.total);
		postProgress(requestId, 'downloading', progress.progress, label, transfer);
	};
}

function postMask(
	id: number,
	width: number,
	height: number,
	alpha: Uint8Array,
	alternatives?: { index: number; count: number }
) {
	const buffer = alpha.buffer.slice(
		alpha.byteOffset,
		alpha.byteOffset + alpha.byteLength
	) as ArrayBuffer;
	post(
		{
			id,
			type: 'mask',
			modelVersion: SMART_MASK_PACK.version,
			width,
			height,
			alpha: buffer,
			alternatives
		},
		[buffer]
	);
}

function postProgress(
	id: number,
	phase: Extract<SmartMaskResponse, { type: 'progress' }>['phase'],
	progress: number | null,
	detail: string,
	transfer: SmartMaskTransfer | null = null
) {
	post({ id, type: 'progress', phase, progress, detail, transfer });
}

function preparedImage(photoId: string) {
	if (!prepared || prepared.photoId !== photoId) {
		throw new Error('Prepare this photo for smart masking');
	}
	return prepared;
}

function resetPreparedImage() {
	objectSlot.model?.disposeEmbedding(prepared?.embedding ?? null);
	prepared = null;
}

function detectPreferredDevice() {
	preferredDevice ??= (async () => {
		if (!('gpu' in navigator) || !navigator.gpu) return 'wasm';
		try {
			return (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm';
		} catch {
			return 'wasm';
		}
	})();
	return preferredDevice;
}

function positiveModulo(value: number, divisor: number) {
	return ((value % divisor) + divisor) % divisor;
}

function errorMessage(error: unknown) {
	reportError('smart mask worker failed', error);
	return error instanceof Error ? error.message : 'Smart masking failed';
}

reportUncaught('smart mask worker', self);
