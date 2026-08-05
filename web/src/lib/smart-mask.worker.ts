import { RawImage, env, pipeline, type ProgressInfo } from '@huggingface/transformers';
import type { Tensor } from 'onnxruntime-web';
import { OpfsModelCache } from './model-cache.ts';
import { alphaChannel } from './mask-raster.ts';
import { createSegNextPrompt } from './segnext-prompt.ts';
import { SegNextRuntime, type SegNextDevice } from './segnext-runtime.ts';
import { SMART_MASK_PACK, type SmartMaskRequest, type SmartMaskResponse } from './smart-mask.ts';

type SubjectPipeline = Awaited<ReturnType<typeof pipeline<'background-removal'>>>;

interface PreparedImage {
	photoId: string;
	image: RawImage;
	embeddings: Tensor | null;
	selection: { id: string; probabilities: Float32Array } | null;
}

let device: SegNextDevice = supportsWebGpu() ? 'webgpu' : 'wasm';
let objectModel: SegNextRuntime | null = null;
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
	prepared = { photoId: request.photoId, image, embeddings: null, selection: null };
	postProgress(request.id, 'ready', 100, 'smart mask ready');
	post({ id: request.id, type: 'prepared', modelVersion: SMART_MASK_PACK.version, device });
}

async function selectObject(request: Extract<SmartMaskRequest, { type: 'object' }>) {
	const active = preparedImage(request.photoId);
	if (request.strokes.length === 0) throw new Error('Paint over an object before selecting it');
	postProgress(request.id, 'loading', null, 'loading object model');
	await loadObjectModel(request.id);
	if (!active.embeddings) {
		postProgress(request.id, 'encoding', null, 'analyzing photo');
		active.embeddings = await objectModel!.encode(active.image);
	}
	postProgress(request.id, 'refining', null, 'refining object');
	const previousMask =
		active.selection?.id === request.selectionId ? active.selection.probabilities : undefined;
	const prompt = createSegNextPrompt(request.strokes, objectModel!.inputSize, previousMask);
	const logits = await objectModel!.decode(active.embeddings, prompt);
	active.selection = {
		id: request.selectionId,
		probabilities: maskProbabilities(logits)
	};
	const alpha = await resizeMask(
		logits,
		objectModel!.inputSize,
		active.image.width,
		active.image.height
	);
	postMask(request.id, active.image.width, active.image.height, alpha);
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

async function loadObjectModel(requestId: number) {
	if (objectModel) return;
	const load = async () => {
		const baseUrl = import.meta.env.VITE_SEGNEXT_MODEL_HOST ?? '/models/segnext';
		objectModel = await SegNextRuntime.load(
			SMART_MASK_PACK.object,
			baseUrl,
			device,
			({ file, progress }) => postProgress(requestId, 'downloading', progress, file)
		);
	};
	await withDeviceFallback(load);
}

async function loadSubjectModel(requestId: number) {
	if (subjectModel) return;
	const load = async () => {
		subjectModel = await pipeline('background-removal', SMART_MASK_PACK.subject.id, {
			...modelOptions(SMART_MASK_PACK.subject, requestId)
		});
	};
	await withDeviceFallback(load);
}

async function withDeviceFallback(load: () => Promise<void>) {
	try {
		await load();
	} catch (error) {
		if (device === 'wasm') throw error;
		device = 'wasm';
		await load();
	}
}

function modelOptions(model: (typeof SMART_MASK_PACK)['subject'], requestId: number) {
	return {
		revision: model.revision,
		dtype: model.dtype,
		device,
		progress_callback: (progress: ProgressInfo) => reportDownload(requestId, progress)
	} as const;
}

function reportDownload(requestId: number, progress: ProgressInfo) {
	if (progress.status !== 'progress') return;
	postProgress(requestId, 'downloading', progress.progress, progress.file);
}

function postMask(id: number, width: number, height: number, alpha: Uint8Array) {
	const buffer = alpha.buffer.slice(
		alpha.byteOffset,
		alpha.byteOffset + alpha.byteLength
	) as ArrayBuffer;
	post({ id, type: 'mask', modelVersion: SMART_MASK_PACK.version, width, height, alpha: buffer }, [
		buffer
	]);
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
	if (!prepared || prepared.photoId !== photoId)
		throw new Error('Prepare this photo for smart masking');
	return prepared;
}

function resetPreparedImage() {
	prepared?.embeddings?.dispose();
	prepared = null;
}

function maskProbabilities(logits: Float32Array) {
	return Float32Array.from(logits, (logit) => 1 / (1 + Math.exp(-logit)));
}

async function resizeMask(logits: Float32Array, size: number, width: number, height: number) {
	if (logits.length !== size * size) throw new Error('SegNext returned an invalid mask');
	const binary = Uint8Array.from(logits, (logit) => (logit > 0 ? 255 : 0));
	const resized = await new RawImage(binary, size, size, 1).resize(width, height);
	return Uint8Array.from(resized.data);
}

function supportsWebGpu() {
	return 'gpu' in navigator && navigator.gpu !== undefined;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Smart masking failed';
}
