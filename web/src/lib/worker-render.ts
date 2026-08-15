import type { ColorSettings, LightSettings } from './develop-settings';
import { imageScopeFromRgba, type ImageScopeData, type ImageScopeTransfer } from './image-scope';
import type { WasmSession } from './wasm-runtime';
import { wasm } from './worker-wasm.ts';
import type { ActiveDocument, DisplayDocument } from './worker-documents.ts';

export function canvasContext(width: number, height: number, willReadFrequently = true) {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { willReadFrequently });
	if (!context) throw new Error('Unable to create an image canvas');
	return context;
}

export function imageData(pixels: Uint8Array, width: number, height: number) {
	return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

export function lightArguments(settings: LightSettings) {
	return [
		settings.exposure,
		settings.contrast,
		settings.highlights,
		settings.shadows,
		settings.whites,
		settings.blacks
	] as const;
}

export function colorArguments(settings: ColorSettings) {
	return [settings.temperature, settings.tint, settings.vibrance, settings.saturation] as const;
}

export function displayTransform(active: DisplayDocument, settings: LightSettings) {
	if (sameLightSettings(active.settings, settings)) return active.light;
	active.light.free();
	active.settings = { ...settings };
	active.light = new wasm.DisplayTransform(...lightArguments(settings));
	active.adjusted = null;
	return active.light;
}

function displayAdjusted(active: DisplayDocument, settings: LightSettings) {
	const light = displayTransform(active, settings);
	active.adjusted ??= light.apply_rgba(new Uint8Array(active.preview.data));
	return active.adjusted;
}

function sameLightSettings(left: LightSettings, right: LightSettings) {
	return (
		left.exposure === right.exposure &&
		left.contrast === right.contrast &&
		left.highlights === right.highlights &&
		left.shadows === right.shadows &&
		left.whites === right.whites &&
		left.blacks === right.blacks
	);
}

export function displayPreview(bitmap: ImageBitmap, maxDimension: number) {
	const scale = Math.min(1, Math.max(256, maxDimension) / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, width, height);
	return context.getImageData(0, 0, width, height);
}

export async function renderPreviewImage(
	active: ActiveDocument,
	settings: LightSettings,
	tone: boolean
) {
	return active.kind === 'raw'
		? renderRawPreviewImage(active.session, settings, tone)
		: renderDisplayImage(active, settings);
}

export function renderRawPreview(session: WasmSession, settings: LightSettings, tone: boolean) {
	const frame = session.preview_frame(...lightArguments(settings), tone);
	try {
		const image = frame.jpeg.buffer as ArrayBuffer;
		const histogram = frame.histogram.buffer as ArrayBuffer;
		const waveform = frame.waveform.buffer as ArrayBuffer;
		const scope = {
			histogram,
			waveform,
			waveformWidth: frame.waveform_width,
			waveformHeight: frame.waveform_height,
			sampleCount: frame.sample_count
		} satisfies ImageScopeTransfer;
		return {
			image,
			mediaType: 'image/jpeg' as const,
			scope,
			transfer: [image, histogram, waveform]
		};
	} finally {
		frame.free();
	}
}

function renderRawPreviewImage(session: WasmSession, settings: LightSettings, tone: boolean) {
	const image = session.preview_jpeg(...lightArguments(settings), tone).buffer as ArrayBuffer;
	return {
		image,
		mediaType: 'image/jpeg' as const,
		transfer: [image]
	};
}

export function renderScope(
	active: ActiveDocument,
	settings: LightSettings,
	tone: boolean,
	sampleTarget: number
) {
	return active.kind === 'raw'
		? renderRawScope(active.session, settings, tone, sampleTarget)
		: renderDisplayScope(active, settings, sampleTarget);
}

function renderRawScope(
	session: WasmSession,
	settings: LightSettings,
	tone: boolean,
	sampleTarget: number
) {
	const frame = session.preview_scope(
		...lightArguments(settings),
		tone,
		Math.max(1, Math.floor(sampleTarget))
	);
	try {
		return transferableScope({
			histogram: frame.histogram,
			waveform: frame.waveform,
			waveformWidth: frame.waveform_width,
			waveformHeight: frame.waveform_height,
			sampleCount: frame.sample_count
		});
	} finally {
		frame.free();
	}
}

export async function renderDisplayPreview(active: DisplayDocument, settings: LightSettings) {
	const image = await renderDisplayImage(active, settings);
	const scope = renderDisplayScope(active, settings);
	return {
		...image,
		scope: scope.data,
		transfer: [...image.transfer, ...scope.transfer]
	};
}

async function renderDisplayImage(active: DisplayDocument, settings: LightSettings) {
	const rgba = new Uint8ClampedArray(displayAdjusted(active, settings));
	const context = canvasContext(active.preview.width, active.preview.height, false);
	context.putImageData(new ImageData(rgba, active.preview.width, active.preview.height), 0, 0);
	const image = await (await context.canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
	return {
		image,
		mediaType: 'image/png' as const,
		transfer: [image]
	};
}

function renderDisplayScope(
	active: DisplayDocument,
	settings: LightSettings,
	sampleTarget?: number
) {
	return transferableScope(
		imageScopeFromRgba(
			new Uint8ClampedArray(displayAdjusted(active, settings)),
			active.preview.width,
			active.preview.height,
			sampleTarget
		)
	);
}

function transferableScope(scope: ImageScopeData) {
	const histogram = scope.histogram.buffer as ArrayBuffer;
	const waveform = scope.waveform.buffer as ArrayBuffer;
	return {
		data: {
			histogram,
			waveform,
			waveformWidth: scope.waveformWidth,
			waveformHeight: scope.waveformHeight,
			sampleCount: scope.sampleCount
		} satisfies ImageScopeTransfer,
		transfer: [histogram, waveform]
	};
}
