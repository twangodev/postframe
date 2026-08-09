import { RawImage, env, pipeline, type ProgressInfo } from '@huggingface/transformers';
import { refineObjectMask, refinePaintedMask } from './mask-edge-refiner.ts';
import { OpfsModelCache } from './model-cache.ts';
import { alphaChannel } from './mask-raster.ts';
import { usableSam2Mask } from './sam2-candidates.ts';
import {
	Sam2ObjectRuntime,
	type Sam2ImageEmbedding,
	type Sam2Selection
} from './sam2-object-runtime.ts';
import {
	SMART_MASK_PACK,
	type SmartMaskDevice,
	type SmartMaskRequest,
	type SmartMaskResponse
} from './smart-mask.ts';

type SubjectPipeline = Awaited<ReturnType<typeof pipeline<'background-removal'>>>;

interface PreparedImage {
	photoId: string;
	image: RawImage;
	embedding: Sam2ImageEmbedding | null;
	selection: { id: string; prompt: string; result: Sam2Selection } | null;
}

let objectDevice: SmartMaskDevice = supportsWebGpu() ? 'webgpu' : 'wasm';
let subjectDevice: SmartMaskDevice = supportsWebGpu() ? 'webgpu' : 'wasm';
let objectModel: Sam2ObjectRuntime | null = null;
let subjectModel: SubjectPipeline | null = null;
let prepared: PreparedImage | null = null;

env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = new OpfsModelCache();
env.remoteHost = import.meta.env.VITE_SMART_MASK_MODEL_HOST ?? SMART_MASK_PACK.subjectHost;

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
			case 'refine-edge':
				refineEdge(request);
				break;
			case 'reset':
				resetPreparedImage();
				post({ id: request.id, type: 'reset' });
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
		device: objectDevice
	});
}

async function selectObject(request: Extract<SmartMaskRequest, { type: 'object' }>) {
	const active = preparedImage(request.photoId);
	try {
		await selectObjectWithActiveDevice(request, active);
	} catch (error) {
		if (objectDevice === 'wasm') throw error;
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
		active.embedding = await objectModel!.encode(active.image);
	}

	postProgress(request.id, 'refining', null, 'finding object');
	const prompt = JSON.stringify(request.strokes);
	if (active.selection?.id !== request.selectionId || active.selection.prompt !== prompt) {
		active.selection = {
			id: request.selectionId,
			prompt,
			result: await objectModel!.select(
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
	const coarseAlpha = await objectModel!.render(viable[index]!, active.embedding);
	postProgress(request.id, 'refining', null, 'refining object edges');
	const alpha = refineObjectMask(active.image, coarseAlpha);
	postMask(request.id, active.image.width, active.image.height, alpha, {
		index,
		count: viable.length
	});
	postProgress(request.id, 'ready', 100, 'smart mask ready');
}

async function selectSubject(request: Extract<SmartMaskRequest, { type: 'subject' }>) {
	const active = preparedImage(request.photoId);
	postProgress(request.id, 'loading', null, 'loading subject model');
	await loadSubjectModel(request.id);
	postProgress(request.id, 'refining', null, 'finding subject');
	const mask = await subjectModel!(active.image);
	const alpha = alphaChannel(mask);
	postMask(request.id, mask.width, mask.height, alpha);
	postProgress(request.id, 'ready', 100, 'smart mask ready');
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

async function loadObjectModel(requestId: number) {
	if (objectModel) return;
	try {
		objectModel = await createObjectModel(requestId);
	} catch (error) {
		if (objectDevice === 'wasm') throw error;
		objectDevice = 'wasm';
		objectModel = await createObjectModel(requestId);
	}
}

function createObjectModel(requestId: number) {
	return Sam2ObjectRuntime.load(SMART_MASK_PACK.object, objectDevice, (progress) =>
		reportDownload(requestId, progress)
	);
}

async function fallBackObjectModel(requestId: number, active: PreparedImage) {
	objectModel?.disposeEmbedding(active.embedding);
	active.embedding = null;
	active.selection = null;
	await objectModel?.dispose();
	objectModel = null;
	objectDevice = 'wasm';
	await loadObjectModel(requestId);
}

async function loadSubjectModel(requestId: number) {
	if (subjectModel) return;
	const load = async () => {
		subjectModel = await pipeline('background-removal', SMART_MASK_PACK.subject.id, {
			...modelOptions(SMART_MASK_PACK.subject, subjectDevice, requestId)
		});
	};
	try {
		await load();
	} catch (error) {
		if (subjectDevice === 'wasm') throw error;
		subjectDevice = 'wasm';
		await load();
	}
}

function modelOptions(
	model: (typeof SMART_MASK_PACK)['subject'],
	device: SmartMaskDevice,
	requestId: number
) {
	return {
		revision: model.revision,
		dtype: model.dtype,
		device,
		progress_callback: (progress: ProgressInfo) => reportDownload(requestId, progress)
	} as const;
}

function reportDownload(requestId: number, progress: ProgressInfo) {
	if (progress.status === 'progress_total') {
		postProgress(requestId, 'downloading', progress.progress, 'object model');
	} else if (progress.status === 'progress') {
		postProgress(requestId, 'downloading', progress.progress, progress.file);
	}
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
	detail: string
) {
	post({ id, type: 'progress', phase, progress, detail });
}

function preparedImage(photoId: string) {
	if (!prepared || prepared.photoId !== photoId) {
		throw new Error('Prepare this photo for smart masking');
	}
	return prepared;
}

function resetPreparedImage() {
	objectModel?.disposeEmbedding(prepared?.embedding ?? null);
	prepared = null;
}

function supportsWebGpu() {
	return 'gpu' in navigator && navigator.gpu !== undefined;
}

function positiveModulo(value: number, divisor: number) {
	return ((value % divisor) + divisor) % divisor;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Smart masking failed';
}
