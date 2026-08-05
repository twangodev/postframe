import * as ort from 'onnxruntime-web/webgpu';
import { OpfsModelCache } from './model-cache.ts';
import type { SegNextModel } from './smart-mask.ts';

export type SegNextDevice = 'webgpu' | 'wasm';

export interface SegNextImage {
	data: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
	channels: number;
}

export interface SegNextDownloadProgress {
	file: string;
	progress: number;
}

type ProgressCallback = (progress: SegNextDownloadProgress) => void;

export class SegNextRuntime {
	private constructor(
		readonly device: SegNextDevice,
		readonly inputSize: number,
		private readonly encoder: ort.InferenceSession,
		private readonly decoder: ort.InferenceSession
	) {}

	static async load(
		model: SegNextModel,
		baseUrl: string,
		device: SegNextDevice,
		onProgress: ProgressCallback
	) {
		const cache = new OpfsModelCache();
		const encoder = await createSession(
			modelUrl(baseUrl, model.files.encoder),
			model.files.encoder,
			device,
			cache,
			({ progress }) => onProgress({ file: model.files.encoder, progress: progress / 2 }),
			device === 'webgpu' ? { image_features: 'gpu-buffer' } : undefined
		);
		try {
			const decoder = await createSession(
				modelUrl(baseUrl, model.files.decoder),
				model.files.decoder,
				device,
				cache,
				({ progress }) => onProgress({ file: model.files.decoder, progress: 50 + progress / 2 })
			);
			return new SegNextRuntime(device, model.inputSize, encoder, decoder);
		} catch (error) {
			await encoder.release();
			throw error;
		}
	}

	async encode(image: SegNextImage) {
		const inputs = await imageTensor(image, this.inputSize);
		const outputs = await this.encoder.run({ image: inputs });
		const features = outputs.image_features;
		if (!features) throw new Error('SegNext did not return image features');
		return features;
	}

	async decode(imageFeatures: ort.Tensor, prompt: Float32Array) {
		const expectedPromptSize = 3 * this.inputSize * this.inputSize;
		if (prompt.length !== expectedPromptSize) throw new Error('The SegNext prompt is invalid');
		const outputs = await this.decoder.run({
			image_features: imageFeatures,
			prompt_map: new ort.Tensor('float32', prompt, [1, 3, this.inputSize, this.inputSize])
		});
		const logits = outputs.mask_logits;
		if (!logits || logits.location !== 'cpu' || !(logits.data instanceof Float32Array)) {
			throw new Error('SegNext did not return mask logits');
		}
		return logits.data;
	}
}

async function createSession(
	url: string,
	file: string,
	device: SegNextDevice,
	cache: OpfsModelCache,
	onProgress: ProgressCallback,
	preferredOutputLocation?: ort.InferenceSession.SessionOptions['preferredOutputLocation']
) {
	const bytes = await modelBytes(url, file, cache, onProgress);
	return ort.InferenceSession.create(bytes, {
		executionProviders: [device],
		graphOptimizationLevel: 'all',
		preferredOutputLocation
	});
}

async function modelBytes(
	url: string,
	file: string,
	cache: OpfsModelCache,
	onProgress: ProgressCallback
) {
	const cached = await cache.match(url);
	if (cached) {
		onProgress({ file, progress: 100 });
		return new Uint8Array(await cached.arrayBuffer());
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Could not download ${file} (${response.status} ${response.statusText})`);
	}
	const bytes = await readResponse(response, (progress) => onProgress({ file, progress }));
	await cache.put(url, new Response(bytes, { headers: response.headers }));
	return bytes;
}

async function readResponse(response: Response, onProgress: (progress: number) => void) {
	const total = Number(response.headers.get('content-length'));
	if (!response.body || !Number.isFinite(total) || total <= 0) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		onProgress(100);
		return bytes;
	}

	const chunks: Uint8Array[] = [];
	const reader = response.body.getReader();
	let loaded = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.byteLength;
		onProgress(Math.min(100, (loaded / total) * 100));
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function imageTensor(image: SegNextImage, size: number) {
	const canvas = new OffscreenCanvas(size, size);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not prepare the photo for SegNext');
	const source = new OffscreenCanvas(image.width, image.height);
	const sourceContext = source.getContext('2d');
	if (!sourceContext) throw new Error('Could not prepare the photo for SegNext');
	const rgba = image.channels === 4 ? image.data : rgbaPixels(image);
	const pixels = new Uint8ClampedArray(rgba.length);
	pixels.set(rgba);
	sourceContext.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(source, 0, 0, size, size);
	const resized = context.getImageData(0, 0, size, size).data;
	const channelSize = size * size;
	const values = new Float32Array(3 * channelSize);
	for (let index = 0; index < channelSize; index += 1) {
		const sourceIndex = index * 4;
		values[index] = resized[sourceIndex]! / 255;
		values[channelSize + index] = resized[sourceIndex + 1]! / 255;
		values[channelSize * 2 + index] = resized[sourceIndex + 2]! / 255;
	}
	return new ort.Tensor('float32', values, [1, 3, size, size]);
}

function rgbaPixels(image: SegNextImage) {
	if (image.channels !== 3) throw new Error('SegNext expects an RGB or RGBA photo');
	const pixels = new Uint8ClampedArray(image.width * image.height * 4);
	for (let index = 0; index < image.width * image.height; index += 1) {
		pixels[index * 4] = image.data[index * 3]!;
		pixels[index * 4 + 1] = image.data[index * 3 + 1]!;
		pixels[index * 4 + 2] = image.data[index * 3 + 2]!;
		pixels[index * 4 + 3] = 255;
	}
	return pixels;
}

function modelUrl(baseUrl: string, file: string) {
	const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, location.origin);
	return new URL(file, base).href;
}
