import {
	AutoProcessor,
	RawImage,
	SamModel,
	env,
	pipeline,
	type ProgressInfo,
	type Tensor
} from '@huggingface/transformers';
import { OpfsModelCache } from './model-cache.ts';
import { alphaChannel } from './mask-raster.ts';
import { SMART_MASK_PACK, type SmartMaskRequest, type SmartMaskResponse } from './smart-mask.ts';

type Device = 'webgpu' | 'wasm';
type SamProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
	post_process_masks: (...args: unknown[]) => Promise<Tensor[]>;
};
type SubjectPipeline = Awaited<ReturnType<typeof pipeline<'background-removal'>>>;

interface PreparedImage {
	photoId: string;
	image: RawImage;
	embeddings: Record<string, Tensor> | null;
}

let device: Device = supportsWebGpu() ? 'webgpu' : 'wasm';
let objectModel: SamModel | null = null;
let objectProcessor: SamProcessor | null = null;
let subjectModel: SubjectPipeline | null = null;
let prepared: PreparedImage | null = null;

env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = new OpfsModelCache();
env.remoteHost = import.meta.env.VITE_SMART_MASK_MODEL_HOST ?? SMART_MASK_PACK.host;

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
	prepared = { photoId: request.photoId, image, embeddings: null };
	postProgress(request.id, 'ready', 100, 'smart mask ready');
	post({ id: request.id, type: 'prepared', modelVersion: SMART_MASK_PACK.version, device });
}

async function selectObject(request: Extract<SmartMaskRequest, { type: 'object' }>) {
	const active = preparedImage(request.photoId);
	if (request.prompts.length === 0) throw new Error('Paint over an object before selecting it');
	postProgress(request.id, 'loading', null, 'loading object model');
	await loadObjectModel(request.id);
	if (!active.embeddings) {
		postProgress(request.id, 'encoding', null, 'analyzing photo');
		const inputs = (await objectProcessor!(active.image)) as Record<string, Tensor> & {
			pixel_values: Tensor;
		};
		active.embeddings = (await objectModel!.get_image_embeddings(inputs)) as Record<string, Tensor>;
	}
	postProgress(request.id, 'refining', null, 'refining object');
	const inputPoints = request.prompts.map(({ point }) => [
		point.x * active.image.width,
		point.y * active.image.height
	]);
	const inputLabels = request.prompts.map(({ label }) => (label === 'foreground' ? 1 : 0));
	const promptInputs = (await objectProcessor!(active.image, {
		input_points: [[inputPoints]],
		input_labels: [[inputLabels]]
	})) as Record<string, Tensor>;
	const outputs = await objectModel!({ ...promptInputs, ...active.embeddings });
	const masks = await objectProcessor!.post_process_masks(
		outputs.pred_masks,
		promptInputs.original_sizes,
		promptInputs.reshaped_input_sizes
	);
	const mask = bestMask(masks[0], outputs.iou_scores);
	postMask(request.id, mask.width, mask.height, mask.alpha);
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
	if (objectModel && objectProcessor) return;
	const load = async () => {
		const options = modelOptions(SMART_MASK_PACK.object, requestId);
		const [model, processor] = await Promise.all([
			SamModel.from_pretrained(SMART_MASK_PACK.object.id, options),
			AutoProcessor.from_pretrained(SMART_MASK_PACK.object.id, options)
		]);
		objectModel = model as SamModel;
		objectProcessor = processor as SamProcessor;
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

function modelOptions(
	model: (typeof SMART_MASK_PACK)['object'] | (typeof SMART_MASK_PACK)['subject'],
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
	if (progress.status !== 'progress') return;
	postProgress(requestId, 'downloading', progress.progress, progress.file);
}

function bestMask(mask: Tensor, scores: Tensor) {
	const width = mask.dims.at(-1) ?? 0;
	const height = mask.dims.at(-2) ?? 0;
	if (width <= 0 || height <= 0) throw new Error('The object model returned an empty mask');
	let selected = 0;
	for (let index = 1; index < scores.data.length; index += 1) {
		if (Number(scores.data[index]) > Number(scores.data[selected])) selected = index;
	}
	const size = width * height;
	const start = selected * size;
	const alpha = new Uint8Array(size);
	for (let index = 0; index < size; index += 1) {
		alpha[index] = Number(mask.data[start + index]) > 0 ? 255 : 0;
	}
	return { width, height, alpha };
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
	prepared = null;
}

function supportsWebGpu() {
	return 'gpu' in navigator && navigator.gpu !== undefined;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Smart masking failed';
}
