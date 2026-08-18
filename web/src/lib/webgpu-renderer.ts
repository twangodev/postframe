import rawTileShader from './raw-tile.wgsl?raw';
import {
	adjustmentsIdentity,
	channelCurvesIdentity,
	colorIdentity,
	detailIdentity,
	developSettingsKey,
	effectsIdentity,
	gradingIdentity,
	luminanceIdentity,
	mixerIdentity,
	type ColorSettings,
	type DevelopSettings,
	type EffectsSettings
} from './develop-settings.ts';
import type { NormalizedCrop } from './edit-document.ts';

const SOURCE_CACHE_BUDGET = 192 * 1024 * 1024;
const LIGHT_LUT_LENGTH = 4096;
const CHANNEL_LUT_LENGTH = 3 * 1024;
const MIXER_LUT_LENGTH = 360;
const MIXER_LUT_VALUES = 3 * MIXER_LUT_LENGTH;
const GRADING_SCALARS = 12;
const UNIFORM_BYTES = 192;
const EFFECTS_UNIFORM_BYTES = 64;
const DETAIL_PLANE_FORMAT: GPUTextureFormat = 'r32float';
const BUFFER_COPY_DST = 0x0008;
const BUFFER_UNIFORM = 0x0040;
const BUFFER_STORAGE = 0x0080;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;

export interface RawRenderProfile {
	transferLut: Float32Array;
	transferLutLength: number;
	mix: Float32Array;
	lookupLowBits: number;
	lookupShift: number;
	radianceMax: number;
}

export interface LinearTileSource {
	rgba: Float32Array;
	detail: Float32Array;
	width: number;
	height: number;
}

/**
 * The Rust-computed compact forms the shader consumes instead of re-deriving
 * each stage: the light response with the luminance curve already composed in,
 * the three channel curves back to back (empty while all three are the
 * identity), the mixer hue tables, and the grading scalars.
 */
export interface DevelopLuts {
	luminance: Float32Array;
	channels: Float32Array;
	mixer: Float32Array;
	grading: Float32Array;
}

/** Where a tile sits in its image, which the position-dependent stages read. */
export interface RawTilePlacement {
	x: number;
	y: number;
	bin: number;
	imageWidth: number;
	imageHeight: number;
	crop: NormalizedCrop | null;
}

interface CachedSource {
	texture: GPUTexture;
	detail: GPUTexture | null;
	width: number;
	height: number;
	bytes: number;
}

export class RawWebGpuRenderer {
	private readonly sources = new Map<string, CachedSource>();
	private readonly transferBuffer: GPUBuffer;
	private readonly mixBuffer: GPUBuffer;
	private readonly lightBuffer: GPUBuffer;
	private readonly channelBuffer: GPUBuffer;
	private readonly mixerBuffer: GPUBuffer;
	private readonly uniformBuffer: GPUBuffer;
	private readonly effectsBuffer: GPUBuffer;
	private readonly detailFallback: GPUTexture;
	private sourceBytes = 0;
	private lutKey = '';
	private lost = false;

	private constructor(
		private readonly device: GPUDevice,
		private readonly format: GPUTextureFormat,
		private readonly pipeline: GPURenderPipeline,
		private readonly profile: RawRenderProfile
	) {
		this.transferBuffer = floatBuffer(device, profile.transferLut, BUFFER_STORAGE);
		this.mixBuffer = floatBuffer(device, profile.mix, BUFFER_STORAGE);
		this.lightBuffer = device.createBuffer({
			size: LIGHT_LUT_LENGTH * Float32Array.BYTES_PER_ELEMENT,
			usage: BUFFER_STORAGE | BUFFER_COPY_DST
		});
		this.channelBuffer = device.createBuffer({
			size: CHANNEL_LUT_LENGTH * Float32Array.BYTES_PER_ELEMENT,
			usage: BUFFER_STORAGE | BUFFER_COPY_DST
		});
		this.mixerBuffer = device.createBuffer({
			size: MIXER_LUT_VALUES * Float32Array.BYTES_PER_ELEMENT,
			usage: BUFFER_STORAGE | BUFFER_COPY_DST
		});
		this.uniformBuffer = device.createBuffer({
			size: UNIFORM_BYTES,
			usage: BUFFER_UNIFORM | BUFFER_COPY_DST
		});
		this.effectsBuffer = device.createBuffer({
			size: EFFECTS_UNIFORM_BYTES,
			usage: BUFFER_UNIFORM | BUFFER_COPY_DST
		});
		this.detailFallback = device.createTexture({
			size: { width: 1, height: 2 },
			format: DETAIL_PLANE_FORMAT,
			usage: TEXTURE_BINDING | TEXTURE_COPY_DST
		});
		void device.lost.then(() => {
			this.lost = true;
			this.clearSources();
		});
	}

	static async create(profile: RawRenderProfile) {
		if (!('gpu' in navigator) || !navigator.gpu) return null;
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return null;
		const device = await adapter.requestDevice();
		const format = navigator.gpu.getPreferredCanvasFormat();
		device.pushErrorScope('validation');
		const module = device.createShaderModule({ code: rawTileShader });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module, entryPoint: 'vertex' },
			fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
			primitive: { topology: 'triangle-list' }
		});
		const validationError = await device.popErrorScope();
		if (validationError) {
			device.destroy();
			throw validationError;
		}
		return new RawWebGpuRenderer(device, format, pipeline, profile);
	}

	hasSource(key: string) {
		return this.sources.has(key);
	}

	async render(
		key: string,
		source: LinearTileSource | null,
		placement: RawTilePlacement,
		adjustments: DevelopSettings,
		tone: boolean,
		luts: DevelopLuts
	) {
		if (this.lost) throw new Error('WebGPU device is unavailable');
		const cached = source ? this.uploadSource(key, source) : this.touchSource(key);
		if (!cached) throw new Error('WebGPU source tile is unavailable');
		this.updateLuts(adjustments, luts);
		this.updateUniforms(cached, adjustments, tone, luts.grading);
		this.updateEffects(placement, adjustments.effects);

		const canvas = new OffscreenCanvas(cached.width, cached.height);
		const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext | null;
		if (!context) throw new Error('WebGPU canvas is unavailable');
		context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: cached.texture.createView() },
				{ binding: 1, resource: { buffer: this.transferBuffer } },
				{ binding: 2, resource: { buffer: this.mixBuffer } },
				{ binding: 3, resource: { buffer: this.lightBuffer } },
				{ binding: 4, resource: { buffer: this.uniformBuffer } },
				{ binding: 5, resource: { buffer: this.channelBuffer } },
				{ binding: 6, resource: { buffer: this.mixerBuffer } },
				{ binding: 7, resource: (cached.detail ?? this.detailFallback).createView() },
				{ binding: 8, resource: { buffer: this.effectsBuffer } }
			]
		});
		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: context.getCurrentTexture().createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 }
				}
			]
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
		this.device.queue.submit([encoder.finish()]);
		await this.device.queue.onSubmittedWorkDone();
		return canvas.transferToImageBitmap();
	}

	destroy() {
		this.lost = true;
		this.clearSources();
		this.detailFallback.destroy();
		this.transferBuffer.destroy();
		this.mixBuffer.destroy();
		this.lightBuffer.destroy();
		this.channelBuffer.destroy();
		this.mixerBuffer.destroy();
		this.uniformBuffer.destroy();
		this.effectsBuffer.destroy();
		this.device.destroy();
	}

	private uploadSource(key: string, source: LinearTileSource) {
		const previous = this.sources.get(key);
		previous?.texture.destroy();
		previous?.detail?.destroy();
		if (previous) this.sourceBytes -= previous.bytes;
		const texture = this.device.createTexture({
			size: { width: source.width, height: source.height },
			format: 'rgba32float',
			usage: TEXTURE_BINDING | TEXTURE_COPY_DST
		});
		this.device.queue.writeTexture(
			{ texture },
			source.rgba,
			{ bytesPerRow: source.width * 16, rowsPerImage: source.height },
			{ width: source.width, height: source.height }
		);
		const cached = {
			texture,
			detail: this.uploadDetailPlanes(source),
			width: source.width,
			height: source.height,
			bytes: source.rgba.byteLength + source.detail.byteLength
		};
		this.sources.delete(key);
		this.sources.set(key, cached);
		this.sourceBytes += cached.bytes;
		this.evictSources(key);
		return cached;
	}

	private touchSource(key: string) {
		const cached = this.sources.get(key);
		if (!cached) return null;
		this.sources.delete(key);
		this.sources.set(key, cached);
		return cached;
	}

	// The fine plane stacked above the coarse one, so one tile needs one texture.
	private uploadDetailPlanes(source: LinearTileSource) {
		if (source.detail.length !== (source.rgba.length / 4) * 2) return null;
		const height = source.height * 2;
		const texture = this.device.createTexture({
			size: { width: source.width, height },
			format: DETAIL_PLANE_FORMAT,
			usage: TEXTURE_BINDING | TEXTURE_COPY_DST
		});
		this.device.queue.writeTexture(
			{ texture },
			source.detail,
			{ bytesPerRow: source.width * 4, rowsPerImage: height },
			{ width: source.width, height }
		);
		return texture;
	}

	private evictSources(currentKey: string) {
		while (this.sourceBytes > SOURCE_CACHE_BUDGET && this.sources.size > 1) {
			const oldestKey = this.sources.keys().next().value as string | undefined;
			if (!oldestKey || oldestKey === currentKey) break;
			const oldest = this.sources.get(oldestKey)!;
			oldest.texture.destroy();
			oldest.detail?.destroy();
			this.sourceBytes -= oldest.bytes;
			this.sources.delete(oldestKey);
		}
	}

	private clearSources() {
		for (const source of this.sources.values()) {
			source.texture.destroy();
			source.detail?.destroy();
		}
		this.sources.clear();
		this.sourceBytes = 0;
	}

	private updateLuts(adjustments: DevelopSettings, luts: DevelopLuts) {
		const key = developSettingsKey(adjustments);
		if (this.lutKey === key) return;
		if (luts.luminance.length !== LIGHT_LUT_LENGTH) {
			throw new Error('Light LUT has an unexpected size');
		}
		if (luts.mixer.length !== MIXER_LUT_VALUES) {
			throw new Error('Mixer LUTs have an unexpected size');
		}
		this.device.queue.writeBuffer(this.lightBuffer, 0, luts.luminance);
		this.device.queue.writeBuffer(this.mixerBuffer, 0, luts.mixer);
		if (luts.channels.length > 0) {
			if (luts.channels.length !== CHANNEL_LUT_LENGTH) {
				throw new Error('Channel curve LUTs have an unexpected size');
			}
			this.device.queue.writeBuffer(this.channelBuffer, 0, luts.channels);
		}
		this.lutKey = key;
	}

	private updateUniforms(
		source: CachedSource,
		adjustments: DevelopSettings,
		tone: boolean,
		gradingScalars: Float32Array
	) {
		const { color, detail } = adjustments;
		if (gradingScalars.length !== GRADING_SCALARS) {
			throw new Error('Grading scalars have an unexpected size');
		}
		const bytes = new ArrayBuffer(UNIFORM_BYTES);
		const integers = new Uint32Array(bytes);
		const floats = new Float32Array(bytes);
		integers[0] = source.width;
		integers[1] = source.height;
		integers[2] = this.profile.lookupLowBits;
		integers[3] = this.profile.lookupShift;
		integers[4] = this.profile.transferLutLength;
		integers[5] = tone ? 1 : 0;
		integers[6] = luminanceIdentity(adjustments) ? 1 : 0;
		integers[7] = colorIdentity(color) ? 1 : 0;
		floats[8] = 2 ** adjustments.light.exposure;
		floats[9] = Math.max(1, this.profile.radianceMax * floats[8]);
		floats[10] = 1 + color.saturation / 100;
		floats[11] = color.vibrance / 100;
		floats.set(balanceGains(color), 12);
		integers[15] = adjustmentsIdentity(adjustments) ? 1 : 0;
		integers[16] = channelCurvesIdentity(adjustments.curve) ? 1 : 0;
		integers[17] = detailIdentity(detail) ? 1 : 0;
		floats[18] = (detail.texture / 100) * MAX_TEXTURE_STOPS;
		floats[19] = (detail.clarity / 100) * MAX_CLARITY_STOPS;
		floats[20] = (detail.sharpenAmount / SHARPEN_RANGE) * MAX_SHARPEN_STOPS;
		floats[21] = detail.dehaze / 100;
		integers[22] = mixerIdentity(adjustments.mixer) ? 1 : 0;
		integers[23] = gradingIdentity(adjustments.grading) ? 1 : 0;
		floats.set(gradingScalars, 24);
		this.device.queue.writeBuffer(this.uniformBuffer, 0, bytes);
	}

	private updateEffects(placement: RawTilePlacement, effects: EffectsSettings) {
		const bytes = new ArrayBuffer(EFFECTS_UNIFORM_BYTES);
		const integers = new Uint32Array(bytes);
		const floats = new Float32Array(bytes);
		integers[0] = placement.x;
		integers[1] = placement.y;
		integers[2] = placement.imageWidth;
		integers[3] = placement.imageHeight;
		const crop = placement.crop ?? { x: 0, y: 0, width: 1, height: 1 };
		floats.set([crop.x, crop.y, crop.width, crop.height], 4);
		floats.set(
			[
				effects.vignetteAmount,
				effects.vignetteMidpoint,
				effects.vignetteRoundness,
				effects.vignetteFeather
			],
			8
		);
		floats.set([effects.grainAmount, effects.grainSize], 12);
		integers[14] = placement.bin;
		integers[15] = effectsIdentity(effects) ? 1 : 0;
		this.device.queue.writeBuffer(this.effectsBuffer, 0, bytes);
	}
}

function floatBuffer(device: GPUDevice, values: Float32Array, usage: GPUBufferUsageFlags) {
	const buffer = device.createBuffer({ size: values.byteLength, usage, mappedAtCreation: true });
	new Float32Array(buffer.getMappedRange()).set(values);
	buffer.unmap();
	return buffer;
}

const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722];
const MAX_TEMPERATURE_SHIFT_STOPS = 0.5;
const MAX_TINT_SHIFT_STOPS = 0.5;

// Mirrors src/detail.rs, which owns these ranges and is where they are tested.
const MAX_TEXTURE_STOPS = 0.5;
const MAX_CLARITY_STOPS = 0.75;
const MAX_SHARPEN_STOPS = 0.6;
const SHARPEN_RANGE = 150;

function balanceGains(color: ColorSettings) {
	const warmth = (color.temperature / 100) * MAX_TEMPERATURE_SHIFT_STOPS;
	const magenta = (color.tint / 100) * MAX_TINT_SHIFT_STOPS;
	const gains = [2 ** warmth, 2 ** -magenta, 2 ** -warmth];
	const luminance = gains.reduce(
		(total, gain, channel) => total + gain * LUMINANCE_WEIGHTS[channel],
		0
	);
	return gains.map((gain) => gain / luminance);
}
