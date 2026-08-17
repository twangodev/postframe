import { freeQuietly } from './diagnostics.ts';
import {
	cloneDevelopSettings,
	sameDevelopSettings,
	type DevelopSettings
} from './develop-settings';
import { cloneCrop, type NormalizedCrop } from './edit-document.ts';
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

export function displayTransform(
	active: DisplayDocument,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null
) {
	if (sameDevelopSettings(active.adjustments, adjustments) && sameCrop(active.crop, crop)) {
		return active.light;
	}
	active.light.free();
	active.adjustments = cloneDevelopSettings(adjustments);
	active.crop = cloneCrop(crop);
	active.light = new wasm.DisplayTransform(active.adjustments, active.crop);
	active.adjusted = null;
	return active.light;
}

function sameCrop(left: NormalizedCrop | null, right: NormalizedCrop | null) {
	if (!left || !right) return left === right;
	return (
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}

function displayAdjusted(
	active: DisplayDocument,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null
) {
	const light = displayTransform(active, adjustments, crop);
	active.adjusted ??= light.apply_rgba(
		new Uint8Array(active.preview.data),
		active.preview.width,
		active.preview.height
	);
	return active.adjusted;
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
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	tone: boolean
) {
	return active.kind === 'raw'
		? renderRawPreviewImage(active.session, adjustments, crop, tone)
		: renderDisplayImage(active, adjustments, crop);
}

export function renderRawPreview(
	session: WasmSession,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	tone: boolean
) {
	const frame = session.preview_frame(adjustments, crop, tone);
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
		freeQuietly('preview frame', frame);
	}
}

function renderRawPreviewImage(
	session: WasmSession,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	tone: boolean
) {
	const image = session.preview_jpeg(adjustments, crop, tone).buffer as ArrayBuffer;
	return {
		image,
		mediaType: 'image/jpeg' as const,
		transfer: [image]
	};
}

export function renderScope(
	active: ActiveDocument,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	tone: boolean,
	sampleTarget: number
) {
	return active.kind === 'raw'
		? renderRawScope(active.session, adjustments, crop, tone, sampleTarget)
		: renderDisplayScope(active, adjustments, crop, sampleTarget);
}

function renderRawScope(
	session: WasmSession,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	tone: boolean,
	sampleTarget: number
) {
	const frame = session.preview_scope(
		adjustments,
		crop,
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
		freeQuietly('scope frame', frame);
	}
}

export async function renderDisplayPreview(
	active: DisplayDocument,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null
) {
	const image = await renderDisplayImage(active, adjustments, crop);
	const scope = renderDisplayScope(active, adjustments, crop);
	return {
		...image,
		scope: scope.data,
		transfer: [...image.transfer, ...scope.transfer]
	};
}

async function renderDisplayImage(
	active: DisplayDocument,
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null
) {
	const rgba = new Uint8ClampedArray(displayAdjusted(active, adjustments, crop));
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
	adjustments: DevelopSettings,
	crop: NormalizedCrop | null,
	sampleTarget?: number
) {
	return transferableScope(
		imageScopeFromRgba(
			new Uint8ClampedArray(displayAdjusted(active, adjustments, crop)),
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
