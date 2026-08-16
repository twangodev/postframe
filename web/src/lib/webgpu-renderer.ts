import type { ColorSettings, LightSettings } from './develop-settings.ts';

const SOURCE_CACHE_BUDGET = 192 * 1024 * 1024;
const LIGHT_LUT_LENGTH = 4096;
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
	width: number;
	height: number;
}

interface CachedSource {
	texture: GPUTexture;
	width: number;
	height: number;
	bytes: number;
}

export class RawWebGpuRenderer {
	private readonly sources = new Map<string, CachedSource>();
	private readonly transferBuffer: GPUBuffer;
	private readonly mixBuffer: GPUBuffer;
	private readonly lightBuffer: GPUBuffer;
	private readonly uniformBuffer: GPUBuffer;
	private sourceBytes = 0;
	private lightKey = '';
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
		this.uniformBuffer = device.createBuffer({
			size: 64,
			usage: BUFFER_UNIFORM | BUFFER_COPY_DST
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
		const module = device.createShaderModule({ code: RAW_TILE_SHADER });
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
		settings: LightSettings,
		color: ColorSettings,
		tone: boolean,
		luminanceLut: Float32Array
	) {
		if (this.lost) throw new Error('WebGPU device is unavailable');
		const cached = source ? this.uploadSource(key, source) : this.touchSource(key);
		if (!cached) throw new Error('WebGPU source tile is unavailable');
		this.updateLight(settings, luminanceLut);
		this.updateUniforms(cached, settings, color, tone);

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
				{ binding: 4, resource: { buffer: this.uniformBuffer } }
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
		this.transferBuffer.destroy();
		this.mixBuffer.destroy();
		this.lightBuffer.destroy();
		this.uniformBuffer.destroy();
		this.device.destroy();
	}

	private uploadSource(key: string, source: LinearTileSource) {
		this.sources.get(key)?.texture.destroy();
		const previous = this.sources.get(key);
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
			width: source.width,
			height: source.height,
			bytes: source.rgba.byteLength
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

	private evictSources(currentKey: string) {
		while (this.sourceBytes > SOURCE_CACHE_BUDGET && this.sources.size > 1) {
			const oldestKey = this.sources.keys().next().value as string | undefined;
			if (!oldestKey || oldestKey === currentKey) break;
			const oldest = this.sources.get(oldestKey)!;
			oldest.texture.destroy();
			this.sourceBytes -= oldest.bytes;
			this.sources.delete(oldestKey);
		}
	}

	private clearSources() {
		for (const source of this.sources.values()) source.texture.destroy();
		this.sources.clear();
		this.sourceBytes = 0;
	}

	private updateLight(settings: LightSettings, luminanceLut: Float32Array) {
		const key = lightKey(settings);
		if (this.lightKey === key) return;
		if (luminanceLut.length !== LIGHT_LUT_LENGTH) {
			throw new Error('Light LUT has an unexpected size');
		}
		this.device.queue.writeBuffer(this.lightBuffer, 0, luminanceLut);
		this.lightKey = key;
	}

	private updateUniforms(
		source: CachedSource,
		settings: LightSettings,
		color: ColorSettings,
		tone: boolean
	) {
		const bytes = new ArrayBuffer(64);
		const integers = new Uint32Array(bytes);
		const floats = new Float32Array(bytes);
		integers[0] = source.width;
		integers[1] = source.height;
		integers[2] = this.profile.lookupLowBits;
		integers[3] = this.profile.lookupShift;
		integers[4] = this.profile.transferLutLength;
		integers[5] = tone ? 1 : 0;
		integers[6] = lightIdentity(settings) ? 1 : 0;
		integers[7] = colorIdentity(color) ? 1 : 0;
		floats[8] = 2 ** settings.exposure;
		floats[9] = Math.max(1, this.profile.radianceMax * floats[8]);
		floats[10] = 1 + color.saturation / 100;
		floats[11] = color.vibrance / 100;
		floats.set(balanceGains(color), 12);
		this.device.queue.writeBuffer(this.uniformBuffer, 0, bytes);
	}
}

function floatBuffer(device: GPUDevice, values: Float32Array, usage: GPUBufferUsageFlags) {
	const buffer = device.createBuffer({ size: values.byteLength, usage, mappedAtCreation: true });
	new Float32Array(buffer.getMappedRange()).set(values);
	buffer.unmap();
	return buffer;
}

function lightIdentity(settings: LightSettings) {
	return (
		settings.contrast === 0 &&
		settings.highlights === 0 &&
		settings.shadows === 0 &&
		settings.whites === 0 &&
		settings.blacks === 0
	);
}

function colorIdentity(color: ColorSettings) {
	return (
		color.temperature === 0 && color.tint === 0 && color.vibrance === 0 && color.saturation === 0
	);
}

const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722];
const MAX_TEMPERATURE_SHIFT_STOPS = 0.5;
const MAX_TINT_SHIFT_STOPS = 0.5;

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

function lightKey(settings: LightSettings) {
	return [
		settings.contrast,
		settings.highlights,
		settings.shadows,
		settings.whites,
		settings.blacks
	].join(':');
}

const RAW_TILE_SHADER = /* wgsl */ `
struct Params {
  size: vec2<u32>,
  lookup_low_bits: u32,
  lookup_shift: u32,
  transfer_lut_length: u32,
  tone: u32,
  light_identity: u32,
  color_identity: u32,
  exposure_gain: f32,
  white: f32,
  saturation_scale: f32,
  vibrance_amount: f32,
  balance: vec3<f32>,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> transfer_lut: array<f32>;
@group(0) @binding(2) var<storage, read> mix: array<f32>;
@group(0) @binding(3) var<storage, read> light_lut: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn camera_lookup(channel: u32, value: f32) -> f32 {
  let low = bitcast<f32>(params.lookup_low_bits);
  let bits = bitcast<u32>(clamp(value, low, 64.0));
  let last_bits = params.lookup_low_bits + ((params.transfer_lut_length - 1u) << params.lookup_shift);
  let base = channel * params.transfer_lut_length;
  if (bits <= params.lookup_low_bits) {
    return transfer_lut[base];
  }
  if (bits >= last_bits) {
    return transfer_lut[base + params.transfer_lut_length - 1u];
  }
  let offset = bits - params.lookup_low_bits;
  let index = offset >> params.lookup_shift;
  let mask = (1u << params.lookup_shift) - 1u;
  let fraction = f32(offset & mask) / f32(1u << params.lookup_shift);
  let below = transfer_lut[base + index];
  return below + fraction * (transfer_lut[base + index + 1u] - below);
}

fn decode_srgb(encoded: vec3<f32>) -> vec3<f32> {
  let low = encoded / 12.92;
  let high = pow((encoded + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(high, low, encoded <= vec3<f32>(0.04045));
}

fn encode_srgb(linear: vec3<f32>) -> vec3<f32> {
  let clamped = clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
  let low = clamped * 12.92;
  let high = 1.055 * pow(clamped, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(high, low, clamped <= vec3<f32>(0.0031308));
}

fn apply_color(linear: vec3<f32>) -> vec3<f32> {
  let balanced = linear * params.balance;
  let maximum = max(balanced.r, max(balanced.g, balanced.b));
  let minimum = min(balanced.r, min(balanced.g, balanced.b));
  let fraction = select(0.0, clamp((maximum - minimum) / maximum, 0.0, 1.0), maximum > 0.0);
  let scale = max(params.saturation_scale * (1.0 + params.vibrance_amount * (1.0 - fraction)), 0.0);
  if (scale == 1.0) {
    return balanced;
  }
  let luminance = dot(balanced, vec3<f32>(0.2126, 0.7152, 0.0722));
  return max(vec3<f32>(luminance) + (balanced - vec3<f32>(luminance)) * scale, vec3<f32>(0.0));
}

fn apply_adjustments(encoded: vec3<f32>) -> vec3<f32> {
  if (params.light_identity == 1u && params.color_identity == 1u) {
    return encoded;
  }
  var linear = decode_srgb(encoded);
  if (params.color_identity != 1u) {
    linear = apply_color(linear);
  }
  if (params.light_identity == 1u) {
    return encode_srgb(linear);
  }
  let luminance = dot(linear, vec3<f32>(0.2126, 0.7152, 0.0722));
  let position = clamp(luminance, 0.0, 1.0) * f32(arrayLength(&light_lut) - 1u);
  let index = min(u32(position), arrayLength(&light_lut) - 2u);
  let fraction = position - f32(index);
  let target_luminance = light_lut[index] + fraction * (light_lut[index + 1u] - light_lut[index]);
  if (luminance <= 0.0000001192092896) {
    return encode_srgb(vec3<f32>(target_luminance));
  }
  let maximum = max(linear.r, max(linear.g, linear.b));
  let gamut_scale = select(3.402823466e+38, 1.0 / maximum, maximum > 0.0);
  let scale = min(target_luminance / luminance, gamut_scale);
  return encode_srgb(linear * scale);
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fragment(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  var exposed = textureLoad(source, vec2<i32>(position.xy), 0).rgb * params.exposure_gain;
  if (params.tone == 1u) {
    let brightest = max(exposed.r, max(exposed.g, exposed.b));
    let compression = (1.0 + brightest / (params.white * params.white)) / (1.0 + brightest);
    exposed *= compression;
  }
  let mixed = vec3<f32>(
    mix[0] * exposed.r + mix[1] * exposed.g + mix[2] * exposed.b,
    mix[3] * exposed.r + mix[4] * exposed.g + mix[5] * exposed.b,
    mix[6] * exposed.r + mix[7] * exposed.g + mix[8] * exposed.b
  );
  let encoded = clamp(vec3<f32>(
    camera_lookup(0u, mixed.r),
    camera_lookup(1u, mixed.g),
    camera_lookup(2u, mixed.b)
  ) / 255.0, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(apply_adjustments(encoded), 1.0);
}
`;
