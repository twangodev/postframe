import init, {
	DisplayTransform,
	Session,
	inspect_raw,
	supported_raw_extensions,
	validate_raw
} from './pf/postframe.js';
import wasmUrl from './pf/postframe_bg.wasm?url';
import type { LightSettings } from './develop-settings';
import { imageScopeFromRgba, type ImageScopeData, type ImageScopeTransfer } from './image-scope';

export interface RawFrameHandleInput {
	raw: FileSystemFileHandle;
	jpeg?: FileSystemFileHandle;
}

export interface RawMetadata {
	width: number;
	height: number;
	orientation: number;
	cameraMake: string | null;
	cameraModel: string | null;
	lens: string | null;
	capturedAt: string | null;
	exposureSeconds: number | null;
	fNumber: number | null;
	iso: number | null;
	focalLengthMm: number | null;
}

export interface RawInspection {
	thumbnailJpeg: ArrayBuffer;
	metadata: RawMetadata;
}

export type DevelopPhase = 'reading' | 'decoding' | 'merging' | 'rendering';

export interface DevelopProgress {
	phase: DevelopPhase;
	bytesRead: number;
	totalBytes: number;
	framesDecoded: number;
	totalFrames: number;
	activeFrame: number;
}

export type RenderPerformanceStage =
	'file-read' | 'raw-decode' | 'display-decode' | 'merge' | 'preview' | 'tile';

export interface RenderPerformanceMeasurement {
	stage: RenderPerformanceStage;
	durationMs: number;
	detail?: string;
}

export interface RenderTileRequest {
	x: number;
	y: number;
	width: number;
	height: number;
	bin: number;
	settings: LightSettings;
	tone: boolean;
}

export type Request =
	| { id: number; type: 'capabilities' }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| {
			id: number;
			type: 'open-raw';
			frames: RawFrameHandleInput[];
			maxDimension: number;
			settings: LightSettings;
	  }
	| {
			id: number;
			type: 'open-display';
			source: FileSystemFileHandle;
			maxDimension: number;
			settings: LightSettings;
	  }
	| ({ id: number; type: 'tile' } & RenderTileRequest)
	| { id: number; type: 'preview'; settings: LightSettings; tone: boolean }
	| {
			id: number;
			type: 'scope';
			settings: LightSettings;
			tone: boolean;
			sampleTarget: number;
	  }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'export' }
	| { id: number; type: 'close' };

export type Response =
	| { id: 0; type: 'performance'; measurement: RenderPerformanceMeasurement }
	| ({ id: number; type: 'progress' } & DevelopProgress)
	| { id: number; type: 'capabilities'; rawExtensions: string[] }
	| { id: number; type: 'validated' }
	| { id: number; type: 'inspected'; inspection: RawInspection }
	| {
			id: number;
			type: 'opened';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
			scope: ImageScopeTransfer;
			boostStops: number | null;
			width: number;
			height: number;
	  }
	| { id: number; type: 'tile'; bitmap: ImageBitmap }
	| {
			id: number;
			type: 'preview';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
	  }
	| { id: number; type: 'scope'; scope: ImageScopeTransfer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
	| { id: number; type: 'closed' }
	| { id: number; type: 'error'; message: string };

interface RawDocument {
	kind: 'raw';
	session: Session;
}

interface DisplayDocument {
	kind: 'display';
	bitmap: ImageBitmap;
	preview: ImageData;
	settings: LightSettings;
	light: DisplayTransform;
	adjusted: Uint8Array | null;
}

type ActiveDocument = RawDocument | DisplayDocument;

const ready = init({ module_or_path: wasmUrl });
let document: ActiveDocument | null = null;
const performanceEnabled = new URL(self.location.href).searchParams.has('perf');

const post = (message: Response, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<Request>) => {
	const message = event.data;
	try {
		await ready;
		switch (message.type) {
			case 'capabilities':
				post({ id: message.id, type: 'capabilities', rawExtensions: supported_raw_extensions() });
				break;
			case 'validate':
				measure('raw-decode', () => validate_raw(new Uint8Array(message.raw)), 'validation');
				post({ id: message.id, type: 'validated' });
				break;
			case 'inspect':
				inspectDocument(message);
				break;
			case 'open-raw':
				await openRawDocument(message);
				break;
			case 'open-display':
				await openDisplayDocument(message);
				break;
			case 'tile': {
				const bitmap = await measureAsync('tile', () => renderTile(activeDocument(), message));
				post({ id: message.id, type: 'tile', bitmap }, [bitmap]);
				break;
			}
			case 'preview': {
				const preview = await renderPreviewImage(activeDocument(), message.settings, message.tone);
				post(
					{
						id: message.id,
						type: 'preview',
						image: preview.image,
						mediaType: preview.mediaType
					},
					preview.transfer
				);
				break;
			}
			case 'scope': {
				const scope = renderScope(
					activeDocument(),
					message.settings,
					message.tone,
					message.sampleTarget
				);
				post({ id: message.id, type: 'scope', scope: scope.data }, scope.transfer);
				break;
			}
			case 'ultra': {
				const jpeg = activeRawDocument().preview_ultra().buffer as ArrayBuffer;
				post({ id: message.id, type: 'ultra', jpeg }, [jpeg]);
				break;
			}
			case 'export': {
				const jpeg = activeRawDocument().export_ultra().buffer as ArrayBuffer;
				post({ id: message.id, type: 'export', jpeg }, [jpeg]);
				break;
			}
			case 'close':
				closeDocument();
				post({ id: message.id, type: 'closed' });
				break;
		}
	} catch (error) {
		post({ id: message.id, type: 'error', message: String(error) });
	}
};

function inspectDocument(message: Extract<Request, { type: 'inspect' }>) {
	const result = measure(
		'raw-decode',
		() => inspect_raw(new Uint8Array(message.raw), message.maxDimension),
		'inspection'
	);
	try {
		const thumbnailJpeg = result.thumbnail_jpeg.buffer as ArrayBuffer;
		post(
			{
				id: message.id,
				type: 'inspected',
				inspection: {
					thumbnailJpeg,
					metadata: {
						width: result.width,
						height: result.height,
						orientation: result.orientation,
						cameraMake: result.camera_make ?? null,
						cameraModel: result.camera_model ?? null,
						lens: result.lens ?? null,
						capturedAt: result.captured_at ?? null,
						exposureSeconds: result.exposure_seconds ?? null,
						fNumber: result.f_number ?? null,
						iso: result.iso ?? null,
						focalLengthMm: result.focal_length_mm ?? null
					}
				}
			},
			[thumbnailJpeg]
		);
	} finally {
		result.free();
	}
}

async function openRawDocument(message: Extract<Request, { type: 'open-raw' }>) {
	closeDocument();
	const session = new Session();

	try {
		const sizes = await Promise.all(
			message.frames.map(async (frame) => ({
				raw: await fileSize(frame.raw),
				jpeg: frame.jpeg ? await fileSize(frame.jpeg) : 0
			}))
		);
		const totalBytes = sizes.reduce((total, frame) => total + frame.raw + frame.jpeg, 0);
		let bytesRead = 0;
		let framesDecoded = 0;
		const progress = (phase: DevelopPhase, activeFrame: number) =>
			post({
				id: message.id,
				type: 'progress',
				phase,
				bytesRead,
				totalBytes,
				framesDecoded,
				totalFrames: message.frames.length,
				activeFrame
			});

		for (const [index, frame] of message.frames.entries()) {
			const activeFrame = index + 1;
			const frameStart = bytesRead;
			progress('reading', activeFrame);
			const raw = await measureAsync(
				'file-read',
				() =>
					readFile(frame.raw, sizes[index].raw, (completed) => {
						bytesRead = frameStart + completed;
						progress('reading', activeFrame);
					}),
				frame.raw.name
			);
			const jpegStart = bytesRead;
			const jpeg = frame.jpeg
				? await measureAsync(
						'file-read',
						() =>
							readFile(frame.jpeg!, sizes[index].jpeg, (completed) => {
								bytesRead = jpegStart + completed;
								progress('reading', activeFrame);
							}),
						frame.jpeg.name
					)
				: undefined;
			progress('decoding', activeFrame);
			measure(
				'raw-decode',
				() => session.add_frame(new Uint8Array(raw), jpeg ? new Uint8Array(jpeg) : undefined),
				frame.raw.name
			);
			framesDecoded = activeFrame;
			progress('decoding', activeFrame);
		}

		progress('merging', message.frames.length);
		measure('merge', () => session.merge(message.maxDimension));
		progress('rendering', message.frames.length);
		document = { kind: 'raw', session };
		const preview = measure('preview', () => renderRawPreview(session, message.settings, true));
		post(
			{
				id: message.id,
				type: 'opened',
				image: preview.image,
				mediaType: preview.mediaType,
				scope: preview.scope,
				boostStops: session.boost_stops(),
				width: session.width(),
				height: session.height()
			},
			preview.transfer
		);
	} catch (error) {
		session.free();
		if (document?.kind === 'raw' && document.session === session) document = null;
		throw error;
	}
}

async function openDisplayDocument(message: Extract<Request, { type: 'open-display' }>) {
	closeDocument();
	const source = await message.source.getFile();
	postDisplayProgress(message, 'reading', 0, source.size);
	const bitmap = await measureAsync(
		'display-decode',
		() => createImageBitmap(source, { imageOrientation: 'from-image' }),
		source.name
	);
	const light = new DisplayTransform(...lightArguments(message.settings));
	try {
		postDisplayProgress(message, 'decoding', source.size, source.size);
		const preview = displayPreview(bitmap, message.maxDimension);
		const next = {
			kind: 'display',
			bitmap,
			preview,
			settings: { ...message.settings },
			light,
			adjusted: null
		} satisfies DisplayDocument;
		document = next;
		postDisplayProgress(message, 'rendering', source.size, source.size);
		const rendered = await measureAsync('preview', () =>
			renderDisplayPreview(next, message.settings)
		);
		post(
			{
				id: message.id,
				type: 'opened',
				image: rendered.image,
				mediaType: rendered.mediaType,
				scope: rendered.scope,
				boostStops: null,
				width: bitmap.width,
				height: bitmap.height
			},
			rendered.transfer
		);
	} catch (error) {
		light.free();
		bitmap.close();
		if (document?.kind === 'display' && document.bitmap === bitmap) document = null;
		throw error;
	}
}

function postDisplayProgress(
	message: Extract<Request, { type: 'open-display' }>,
	phase: DevelopPhase,
	bytesRead: number,
	totalBytes: number
) {
	post({
		id: message.id,
		type: 'progress',
		phase,
		bytesRead,
		totalBytes,
		framesDecoded: phase === 'reading' ? 0 : 1,
		totalFrames: 1,
		activeFrame: 1
	});
}

function displayPreview(bitmap: ImageBitmap, maxDimension: number) {
	const scale = Math.min(1, Math.max(256, maxDimension) / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, width, height);
	return context.getImageData(0, 0, width, height);
}

async function renderPreviewImage(active: ActiveDocument, settings: LightSettings, tone: boolean) {
	return active.kind === 'raw'
		? renderRawPreviewImage(active.session, settings, tone)
		: renderDisplayImage(active, settings);
}

function renderRawPreview(session: Session, settings: LightSettings, tone: boolean) {
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

function renderRawPreviewImage(session: Session, settings: LightSettings, tone: boolean) {
	const image = session.preview_jpeg(...lightArguments(settings), tone).buffer as ArrayBuffer;
	return {
		image,
		mediaType: 'image/jpeg' as const,
		transfer: [image]
	};
}

function renderScope(
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
	session: Session,
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

async function renderDisplayPreview(active: DisplayDocument, settings: LightSettings) {
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

async function renderTile(active: ActiveDocument, request: RenderTileRequest) {
	if (active.kind === 'raw') {
		const tile = active.session.render_tile(
			request.x,
			request.y,
			request.width,
			request.height,
			request.bin,
			...lightArguments(request.settings),
			request.tone
		);
		try {
			const context = canvasContext(tile.width, tile.height, false);
			context.putImageData(imageData(tile.rgba, tile.width, tile.height), 0, 0);
			return context.canvas.transferToImageBitmap();
		} finally {
			tile.free();
		}
	}

	const width = Math.ceil(request.width / request.bin);
	const height = Math.ceil(request.height / request.bin);
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = request.bin > 1;
	context.imageSmoothingQuality = 'high';
	context.drawImage(
		active.bitmap,
		request.x,
		request.y,
		request.width,
		request.height,
		0,
		0,
		width,
		height
	);
	const pixels = context.getImageData(0, 0, width, height);
	const adjusted = displayTransform(active, request.settings).apply_rgba(
		new Uint8Array(pixels.data)
	);
	context.putImageData(imageData(adjusted, width, height), 0, 0);
	return context.canvas.transferToImageBitmap();
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

function canvasContext(width: number, height: number, willReadFrequently = true) {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { willReadFrequently });
	if (!context) throw new Error('Unable to create an image canvas');
	return context;
}

function imageData(pixels: Uint8Array, width: number, height: number) {
	return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

function lightArguments(settings: LightSettings) {
	return [
		settings.exposure,
		settings.contrast,
		settings.highlights,
		settings.shadows,
		settings.whites,
		settings.blacks
	] as const;
}

function displayTransform(active: DisplayDocument, settings: LightSettings) {
	if (sameLightSettings(active.settings, settings)) return active.light;
	active.light.free();
	active.settings = { ...settings };
	active.light = new DisplayTransform(...lightArguments(settings));
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

const READ_PROGRESS_STEP = 4 * 1024 * 1024;

async function fileSize(handle: FileSystemFileHandle) {
	return handle.getFile().then((file) => file.size);
}

async function readFile(
	handle: FileSystemFileHandle,
	expectedSize: number,
	onProgress: (completed: number) => void
) {
	const syncHandle = handle as FileSystemFileHandle & {
		createSyncAccessHandle?: () => Promise<{
			getSize: () => number;
			read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
			close: () => void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle !== 'function') {
		const file = await handle.getFile();
		const bytes = new Uint8Array(file.size);
		const reader = file.stream().getReader();
		let offset = 0;
		let reported = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes.set(value, offset);
			offset += value.byteLength;
			if (offset === bytes.byteLength || offset - reported >= READ_PROGRESS_STEP) {
				reported = offset;
				onProgress(offset);
			}
		}
		if (offset !== bytes.byteLength) throw new Error(`Unable to finish reading ${handle.name}`);
		return bytes.buffer;
	}

	const access = await syncHandle.createSyncAccessHandle();
	try {
		const bytes = new Uint8Array(access.getSize());
		let offset = 0;
		while (offset < bytes.byteLength) {
			const end = Math.min(offset + READ_PROGRESS_STEP, bytes.byteLength);
			const read = access.read(bytes.subarray(offset, end), { at: offset });
			if (read === 0) throw new Error(`Unable to finish reading ${handle.name}`);
			offset += read;
			onProgress(Math.min(offset, expectedSize));
		}
		return bytes.buffer;
	} finally {
		access.close();
	}
}

function activeDocument() {
	if (!document) throw new Error('Open a document before rendering');
	return document;
}

function activeRawDocument() {
	const active = activeDocument();
	if (active.kind !== 'raw') throw new Error('This operation requires a RAW document');
	return active.session;
}

function closeDocument() {
	if (document?.kind === 'raw') document.session.free();
	if (document?.kind === 'display') {
		document.light.free();
		document.bitmap.close();
	}
	document = null;
}

function measure<T>(stage: RenderPerformanceStage, operation: () => T, detail?: string): T {
	const startedAt = performance.now();
	try {
		return operation();
	} finally {
		postMeasurement(stage, startedAt, detail);
	}
}

async function measureAsync<T>(
	stage: RenderPerformanceStage,
	operation: () => Promise<T>,
	detail?: string
): Promise<T> {
	const startedAt = performance.now();
	try {
		return await operation();
	} finally {
		postMeasurement(stage, startedAt, detail);
	}
}

function postMeasurement(stage: RenderPerformanceStage, startedAt: number, detail?: string) {
	if (!performanceEnabled) return;
	post({
		id: 0,
		type: 'performance',
		measurement: { stage, durationMs: performance.now() - startedAt, detail }
	});
}
