import {
	developSettingsKey,
	isIdentityCurve,
	type ColorSettings,
	type CurveSettings,
	type DetailSettings,
	type DevelopSettings,
	type EffectsSettings,
	type GradingSettings,
	type LightSettings,
	type MixerSettings
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

function lightIdentity(settings: LightSettings) {
	return (
		settings.contrast === 0 &&
		settings.highlights === 0 &&
		settings.shadows === 0 &&
		settings.whites === 0 &&
		settings.blacks === 0
	);
}

// The luminance curve is composed into the light LUT, so it decides with the
// light controls whether the tone stage has anything to do.
function luminanceIdentity({ light, curve }: DevelopSettings) {
	return lightIdentity(light) && isIdentityCurve(curve.luminance);
}

function channelCurvesIdentity(curve: CurveSettings) {
	return [curve.red, curve.green, curve.blue].every(isIdentityCurve);
}

function colorIdentity(color: ColorSettings) {
	return (
		color.temperature === 0 && color.tint === 0 && color.vibrance === 0 && color.saturation === 0
	);
}

function detailIdentity(detail: DetailSettings) {
	return (
		detail.texture === 0 &&
		detail.clarity === 0 &&
		detail.dehaze === 0 &&
		detail.sharpenAmount === 0
	);
}

function effectsIdentity(effects: EffectsSettings) {
	return effects.vignetteAmount === 0 && effects.grainAmount === 0;
}

function mixerIdentity(mixer: MixerSettings) {
	return Object.values(mixer).every(
		(band) => band.hue === 0 && band.saturation === 0 && band.luminance === 0
	);
}

function gradingIdentity(grading: GradingSettings) {
	return [grading.shadows, grading.midtones, grading.highlights].every(
		(wheel) => wheel.saturation === 0 && wheel.luminance === 0
	);
}

function adjustmentsIdentity(adjustments: DevelopSettings) {
	return (
		luminanceIdentity(adjustments) &&
		colorIdentity(adjustments.color) &&
		channelCurvesIdentity(adjustments.curve) &&
		mixerIdentity(adjustments.mixer) &&
		gradingIdentity(adjustments.grading) &&
		detailIdentity(adjustments.detail) &&
		effectsIdentity(adjustments.effects)
	);
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
  adjustments_identity: u32,
  curve_identity: u32,
  detail_identity: u32,
  texture_stops: f32,
  clarity_stops: f32,
  sharpen_stops: f32,
  haze: f32,
  mixer_identity: u32,
  grading_identity: u32,
  grading_shadow_edge: f32,
  grading_highlight_edge: f32,
  grading_crossfade: f32,
  shadow_hue: f32,
  shadow_mix: f32,
  shadow_stops: f32,
  midtone_hue: f32,
  midtone_mix: f32,
  midtone_stops: f32,
  highlight_hue: f32,
  highlight_mix: f32,
  highlight_stops: f32,
}

// Vignette and grain in the shape src/effects.rs computes them, whose tests
// pin the grain values this must reproduce.
struct Effects {
  origin: vec2<u32>,
  image: vec2<u32>,
  crop: vec4<f32>,
  vignette: vec4<f32>,
  grain: vec2<f32>,
  bin: u32,
  identity: u32,
}

const LUMINANCE_WEIGHTS = vec3<f32>(0.2126, 0.7152, 0.0722);
const LUMINANCE_FLOOR = 0.0000152587890625;
const DEHAZE_AMBIENT = 1.0;
const MAX_DEHAZE_VEIL = 0.9;
const MAX_HAZE_BLEND = 0.6;
const MIN_TRANSMISSION = 0.1;

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> transfer_lut: array<f32>;
@group(0) @binding(2) var<storage, read> mix: array<f32>;
@group(0) @binding(3) var<storage, read> light_lut: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> channel_lut: array<f32>;
@group(0) @binding(6) var<storage, read> mixer_shift_then_saturation_then_luminance: array<f32>;
@group(0) @binding(7) var detail_planes: texture_2d<f32>;
@group(0) @binding(8) var<uniform> effects: Effects;

const MIXER_HUES: u32 = 360u;
const MIDDLE_GRAY: f32 = 0.18;

const MAX_VIGNETTE_STOPS: f32 = 2.0;
const MAX_ROUNDNESS_EXPONENT: f32 = 6.0;
const ELLIPSE_EXPONENT: f32 = 2.0;
const MIN_FEATHER_SPAN: f32 = 0.08;
const MIN_ASPECT: f32 = 1.1920929e-7;
const MIN_GRAIN_FRACTION: f32 = 0.00025;
const MAX_GRAIN_FRACTION: f32 = 0.002;
const MAX_GRAIN_AMPLITUDE: f32 = 24.0;
const GRAIN_SEED: u32 = 0x9E3779B9u;

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

fn apply_balance(linear: vec3<f32>) -> vec3<f32> {
  return linear * params.balance;
}

fn apply_chroma(linear: vec3<f32>) -> vec3<f32> {
  let fraction = chroma_fraction(linear);
  let scale = max(params.saturation_scale * (1.0 + params.vibrance_amount * (1.0 - fraction)), 0.0);
  if (scale == 1.0) {
    return linear;
  }
  let luminance = dot(linear, LUMINANCE_WEIGHTS);
  return max(vec3<f32>(luminance) + (linear - vec3<f32>(luminance)) * scale, vec3<f32>(0.0));
}

fn chroma_fraction(linear: vec3<f32>) -> f32 {
  let maximum = max(linear.r, max(linear.g, linear.b));
  let minimum = min(linear.r, min(linear.g, linear.b));
  return select(0.0, clamp((maximum - minimum) / maximum, 0.0, 1.0), maximum > 0.0);
}

fn hue_degrees(linear: vec3<f32>) -> f32 {
  let maximum = max(linear.r, max(linear.g, linear.b));
  let minimum = min(linear.r, min(linear.g, linear.b));
  let chroma = maximum - minimum;
  if (chroma <= 0.0) {
    return 0.0;
  }
  var sextant = (linear.r - linear.g) / chroma + 4.0;
  if (maximum == linear.r) {
    sextant = (linear.g - linear.b) / chroma;
  } else if (maximum == linear.g) {
    sextant = (linear.b - linear.r) / chroma + 2.0;
  }
  let degrees = sextant * 60.0;
  return degrees - floor(degrees / 360.0) * 360.0;
}

fn from_hue(degrees: f32, saturation: f32, value: f32) -> vec3<f32> {
  let position = (degrees - floor(degrees / 360.0) * 360.0) / 60.0;
  let chroma = value * clamp(saturation, 0.0, 1.0);
  let ramp = chroma * (1.0 - abs(position % 2.0 - 1.0));
  var sextant = vec3<f32>(chroma, 0.0, ramp);
  if (position < 1.0) {
    sextant = vec3<f32>(chroma, ramp, 0.0);
  } else if (position < 2.0) {
    sextant = vec3<f32>(ramp, chroma, 0.0);
  } else if (position < 3.0) {
    sextant = vec3<f32>(0.0, chroma, ramp);
  } else if (position < 4.0) {
    sextant = vec3<f32>(0.0, ramp, chroma);
  } else if (position < 5.0) {
    sextant = vec3<f32>(ramp, 0.0, chroma);
  }
  return sextant + vec3<f32>(value - chroma);
}

fn mixer_sample(table: u32, hue: f32) -> f32 {
  let hues = f32(MIXER_HUES);
  let position = hue - floor(hue / hues) * hues;
  let index = min(u32(position), MIXER_HUES - 1u);
  let base = table * MIXER_HUES;
  let below = mixer_shift_then_saturation_then_luminance[base + index];
  let above = mixer_shift_then_saturation_then_luminance[base + (index + 1u) % MIXER_HUES];
  return below + (position - f32(index)) * (above - below);
}

fn apply_mixer(linear: vec3<f32>) -> vec3<f32> {
  let chroma = chroma_fraction(linear);
  if (chroma <= 0.0) {
    return linear;
  }
  let hue = hue_degrees(linear);
  let shift = mixer_sample(0u, hue) * chroma;
  let saturation = 1.0 + (mixer_sample(1u, hue) - 1.0) * chroma;
  let luminance = 1.0 + (mixer_sample(2u, hue) - 1.0) * chroma;
  var adjusted = linear;
  if (shift != 0.0) {
    adjusted = from_hue(hue + shift, chroma, max(adjusted.r, max(adjusted.g, adjusted.b)));
  }
  if (saturation != 1.0) {
    let gray = dot(adjusted, LUMINANCE_WEIGHTS);
    adjusted = max(vec3<f32>(gray) + (adjusted - vec3<f32>(gray)) * saturation, vec3<f32>(0.0));
  }
  return max(adjusted * luminance, vec3<f32>(0.0));
}

fn grading_tint(linear: vec3<f32>, hue: f32, amount: f32) -> vec3<f32> {
  if (amount <= 0.0) {
    return linear;
  }
  let brightest = max(0.0, max(linear.r, max(linear.g, linear.b)));
  return linear + (from_hue(hue, 1.0, brightest) - linear) * amount;
}

fn apply_grading(linear: vec3<f32>) -> vec3<f32> {
  let stops = log2(max(dot(linear, LUMINANCE_WEIGHTS), 1.1754944e-38) / MIDDLE_GRAY);
  let crossfade = params.grading_crossfade;
  let shadow = 1.0 - smoothstep(
    params.grading_shadow_edge - crossfade,
    params.grading_shadow_edge + crossfade,
    stops
  );
  let highlight = smoothstep(
    params.grading_highlight_edge - crossfade,
    params.grading_highlight_edge + crossfade,
    stops
  );
  let weights = vec3<f32>(shadow, 1.0 - shadow - highlight, highlight);
  var tinted = grading_tint(linear, params.shadow_hue, params.shadow_mix * weights.x);
  tinted = grading_tint(tinted, params.midtone_hue, params.midtone_mix * weights.y);
  tinted = grading_tint(tinted, params.highlight_hue, params.highlight_mix * weights.z);
  let stop_shift = dot(
    vec3<f32>(params.shadow_stops, params.midtone_stops, params.highlight_stops),
    weights
  );
  return max(tinted * exp2(stop_shift), vec3<f32>(0.0));
}

// The fine plane occupies the tile's rows, the coarse plane the rows below it.
fn detail_sample(position: vec2<i32>) -> vec2<f32> {
  let coarse = position + vec2<i32>(0, i32(params.size.y));
  return vec2<f32>(
    textureLoad(detail_planes, position, 0).r,
    textureLoad(detail_planes, coarse, 0).r
  );
}

fn apply_dehaze(linear: vec3<f32>) -> vec3<f32> {
  if (params.haze < 0.0) {
    let blend = -params.haze * MAX_HAZE_BLEND;
    return linear + (vec3<f32>(DEHAZE_AMBIENT) - linear) * blend;
  }
  let dark = min(linear.r, min(linear.g, linear.b));
  let transmission = max(1.0 - params.haze * MAX_DEHAZE_VEIL * dark, MIN_TRANSMISSION);
  let veil = vec3<f32>(DEHAZE_AMBIENT * (1.0 - transmission));
  return max((linear - veil) / transmission, vec3<f32>(0.0));
}

fn apply_detail(linear: vec3<f32>, detail: vec2<f32>) -> vec3<f32> {
  let luminance = dot(linear, LUMINANCE_WEIGHTS);
  if (luminance <= LUMINANCE_FLOOR) {
    return linear;
  }
  let encoded = encode_srgb(vec3<f32>(luminance)).r;
  let midtone = 4.0 * encoded * (1.0 - encoded);
  let stops = (params.texture_stops + params.sharpen_stops) * detail.x
    + params.clarity_stops * midtone * detail.y;
  if (stops == 0.0) {
    return linear;
  }
  let maximum = max(linear.r, max(linear.g, linear.b));
  let gamut = select(3.402823466e+38, 1.0 / maximum, maximum > 0.0);
  return linear * min(exp2(stops), gamut);
}

fn apply_light(linear: vec3<f32>) -> vec3<f32> {
  let luminance = dot(linear, LUMINANCE_WEIGHTS);
  let position = clamp(luminance, 0.0, 1.0) * f32(arrayLength(&light_lut) - 1u);
  let index = min(u32(position), arrayLength(&light_lut) - 2u);
  let fraction = position - f32(index);
  let target_luminance = light_lut[index] + fraction * (light_lut[index + 1u] - light_lut[index]);
  if (luminance <= 0.0000001192092896) {
    return vec3<f32>(target_luminance);
  }
  let maximum = max(linear.r, max(linear.g, linear.b));
  let gamut_scale = select(3.402823466e+38, 1.0 / maximum, maximum > 0.0);
  let scale = min(target_luminance / luminance, gamut_scale);
  return linear * scale;
}

fn channel_curve(channel: u32, value: f32) -> f32 {
  let samples = arrayLength(&channel_lut) / 3u;
  let position = clamp(value, 0.0, 1.0) * f32(samples - 1u);
  let index = min(u32(position), samples - 2u);
  let base = channel * samples + index;
  let below = channel_lut[base];
  return below + (position - f32(index)) * (channel_lut[base + 1u] - below);
}

fn apply_channel_curves(encoded: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    channel_curve(0u, encoded.r),
    channel_curve(1u, encoded.g),
    channel_curve(2u, encoded.b)
  );
}

fn image_pixel(position: vec2<f32>) -> vec2<u32> {
  return effects.origin + vec2<u32>(position) * effects.bin + vec2<u32>(effects.bin / 2u);
}

fn superellipse(point: vec2<f32>, exponent: f32) -> f32 {
  let raised = pow(abs(point), vec2<f32>(exponent));
  return pow(raised.x + raised.y, 1.0 / exponent);
}

fn apply_vignette(linear: vec3<f32>, pixel: vec2<u32>) -> vec3<f32> {
  let amount = effects.vignette.x;
  if (amount == 0.0) {
    return linear;
  }
  let image = max(vec2<f32>(effects.image), vec2<f32>(1.0));
  let at = (vec2<f32>(pixel) + vec2<f32>(0.5)) / image;
  let aspect = max(image.x / image.y, MIN_ASPECT);
  let centre = effects.crop.xy + effects.crop.zw * 0.5;
  let reach = vec2<f32>(effects.crop.z * 0.5 * aspect, effects.crop.w * 0.5);
  let roundness = effects.vignette.z / 100.0;
  let exponent = ELLIPSE_EXPONENT
    + max(roundness, 0.0) * (MAX_ROUNDNESS_EXPONENT - ELLIPSE_EXPONENT);
  let semi_axis = pow(reach.x / reach.y, clamp(roundness + 1.0, 0.0, 1.0));
  let offset = vec2<f32>((at.x - centre.x) * aspect / semi_axis, at.y - centre.y);
  let corner = vec2<f32>(reach.x / semi_axis, reach.y);
  let distance = superellipse(offset, exponent) / superellipse(corner, exponent);
  let midpoint = effects.vignette.y / 100.0;
  let span = MIN_FEATHER_SPAN + effects.vignette.w / 100.0 * (1.0 - MIN_FEATHER_SPAN);
  let start = max(midpoint - span * 0.5, 0.0);
  let end = max(midpoint + span * 0.5, start + MIN_FEATHER_SPAN);
  let falloff = smoothstep(start, end, distance);
  return linear * exp2(amount / 100.0 * MAX_VIGNETTE_STOPS * falloff);
}

fn grain_at(x: u32, y: u32, cell: u32) -> f32 {
  let span = max(cell, 1u);
  var mixed = ((x / span) * 0x8DA6B343u + (y / span) * 0xD8163841u) ^ GRAIN_SEED;
  mixed ^= mixed >> 16u;
  mixed = mixed * 0x7FEB352Du;
  mixed ^= mixed >> 15u;
  mixed = mixed * 0x846CA68Bu;
  mixed ^= mixed >> 16u;
  return f32(mixed >> 8u) / 8388607.5 - 1.0;
}

fn apply_grain(encoded: vec3<f32>, pixel: vec2<u32>) -> vec3<f32> {
  let amount = effects.grain.x;
  if (amount == 0.0) {
    return encoded;
  }
  let reference = f32(max(max(effects.image.x, effects.image.y), 1u));
  let fraction = MIN_GRAIN_FRACTION
    + (MAX_GRAIN_FRACTION - MIN_GRAIN_FRACTION) * effects.grain.y / 100.0;
  let cell = max(u32(floor(reference * fraction + 0.5)), 1u);
  let luminance = clamp(dot(encoded, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let weight = 4.0 * luminance * (1.0 - luminance);
  let offset = amount / 100.0 * MAX_GRAIN_AMPLITUDE * weight * grain_at(pixel.x, pixel.y, cell);
  return clamp(encoded + vec3<f32>(offset / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Stages run in the order fixed by DevelopTransform in src/develop.rs.
fn apply_adjustments(encoded: vec3<f32>, tile: vec2<i32>, pixel: vec2<u32>) -> vec3<f32> {
  if (params.adjustments_identity == 1u) {
    return encoded;
  }
  var linear = decode_srgb(encoded);
  if (params.color_identity != 1u) {
    linear = apply_balance(linear);
  }
  if (params.mixer_identity != 1u) {
    linear = apply_mixer(linear);
  }
  if (params.grading_identity != 1u) {
    linear = apply_grading(linear);
  }
  if (params.color_identity != 1u) {
    linear = apply_chroma(linear);
  }
  if (params.detail_identity != 1u) {
    linear = apply_detail(apply_dehaze(linear), detail_sample(tile));
  }
  if (effects.identity != 1u) {
    linear = apply_vignette(linear, pixel);
  }
  if (params.light_identity != 1u) {
    linear = apply_light(linear);
  }
  var display = encode_srgb(linear);
  if (params.curve_identity != 1u) {
    display = apply_channel_curves(display);
  }
  if (effects.identity != 1u) {
    display = apply_grain(display, pixel);
  }
  return display;
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
  let pixel = vec2<i32>(position.xy);
  var exposed = textureLoad(source, pixel, 0).rgb * params.exposure_gain;
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
  return vec4<f32>(apply_adjustments(encoded, pixel, image_pixel(position.xy)), 1.0);
}
`;
