import type { LightSettings } from './develop-settings';
import { imageScopeFromRgba, type ImageScopeData, type ImageScopeTransfer } from './image-scope';
import {
	loadWasmRuntime,
	type WasmDisplayTransform,
	type WasmDevelopedTileCompositor,
	type WasmModule,
	type WasmSession
} from './wasm-runtime';
import {
	RawWebGpuRenderer,
	type LinearTileSource,
	type RawRenderProfile
} from './webgpu-renderer.ts';
import { adjustMaskEdges } from './mask-edge-adjustment.ts';
import type { MaskEdgeSettings } from './mask-edge-settings.ts';
import {
	cropRegion,
	exportTiles,
	identityGeometry,
	rotatedBounds,
	type ExportGeometry,
	type ExportPhase,
	type ExportProgress,
	type ExportRegion
} from './export.ts';

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
	| 'file-read'
	| 'cache-read'
	| 'cache-restore'
	| 'cache-write'
	| 'raw-decode'
	| 'display-decode'
	| 'merge'
	| 'preview'
	| 'tile';

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

export interface DevelopedMaskInput {
	id: string;
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
	settings: LightSettings;
}

export interface MaskEdgeInput {
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
}

export type Request =
	| { id: number; type: 'capabilities'; performance?: boolean }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| {
			id: number;
			type: 'open-raw';
			frames: RawFrameHandleInput[];
			cache: FileSystemFileHandle;
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
	| ({ id: number; type: 'adjust-mask' } & MaskEdgeInput)
	| { id: number; type: 'set-masks'; masks: DevelopedMaskInput[] }
	| { id: number; type: 'preview'; settings: LightSettings; tone: boolean }
	| {
			id: number;
			type: 'scope';
			settings: LightSettings;
			tone: boolean;
			sampleTarget: number;
	  }
	| { id: number; type: 'ultra' }
	| {
			id: number;
			type: 'export';
			settings: LightSettings;
			masks: DevelopedMaskInput[];
			geometry: ExportGeometry;
			quality: number;
	  }
	| { id: number; type: 'close' };

export type Response =
	| { id: 0; type: 'performance'; measurement: RenderPerformanceMeasurement }
	| { id: number; type: 'mask-adjusted'; alpha: ArrayBuffer }
	| ({ id: number; type: 'progress' } & DevelopProgress)
	| {
			id: number;
			type: 'capabilities';
			rawExtensions: string[];
			threaded: boolean;
			threadCount: number;
	  }
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
	| { id: number; type: 'masks-set' }
	| {
			id: number;
			type: 'preview';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
	  }
	| { id: number; type: 'scope'; scope: ImageScopeTransfer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| ({ id: number; type: 'export-progress' } & ExportProgress)
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
	| { id: number; type: 'closed' }
	| { id: number; type: 'error'; message: string };

interface RawDocument {
	kind: 'raw';
	session: WasmSession;
	renderer: RawWebGpuRenderer | null;
	lightLut: { key: string; values: Float32Array } | null;
}

interface DisplayDocument {
	kind: 'display';
	bitmap: ImageBitmap;
	preview: ImageData;
	settings: LightSettings;
	light: WasmDisplayTransform;
	adjusted: Uint8Array | null;
}

type ActiveDocument = RawDocument | DisplayDocument;

let wasm: WasmModule;
let threaded = false;
let threadCount = 1;
const ready = loadWasmRuntime().then((runtime) => {
	wasm = runtime.module;
	threaded = runtime.threaded;
	threadCount = runtime.threadCount;
});
let document: ActiveDocument | null = null;
let maskCompositors: { id: string; compositor: WasmDevelopedTileCompositor }[] = [];
let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCacheWrite: { session: WasmSession; cache: FileSystemFileHandle } | null = null;
let performanceEnabled = false;

const post = (message: Response, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<Request>) => {
	const message = event.data;
	try {
		await ready;
		switch (message.type) {
			case 'capabilities':
				performanceEnabled = message.performance === true;
				post({
					id: message.id,
					type: 'capabilities',
					rawExtensions: wasm.supported_raw_extensions(),
					threaded,
					threadCount
				});
				break;
			case 'validate':
				measure('raw-decode', () => wasm.validate_raw(new Uint8Array(message.raw)), 'validation');
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
				const active = activeDocument();
				deferRawCacheWrite(active);
				try {
					const bitmap = await measureAsync('tile', () => renderTile(active, message));
					post({ id: message.id, type: 'tile', bitmap }, [bitmap]);
				} finally {
					deferRawCacheWrite(active);
				}
				break;
			}
			case 'adjust-mask': {
				const adjusted = adjustMaskEdges(
					{
						width: message.width,
						height: message.height,
						alpha: new Uint8Array(message.alpha)
					},
					message.edge
				);
				const alpha = adjusted.alpha.buffer as ArrayBuffer;
				post({ id: message.id, type: 'mask-adjusted', alpha }, [alpha]);
				break;
			}
			case 'set-masks':
				setMaskCompositors(message.masks);
				post({ id: message.id, type: 'masks-set' });
				break;
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
				const jpeg = exportDocument(activeDocument(), message);
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
		() => wasm.inspect_raw(new Uint8Array(message.raw), message.maxDimension),
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
	const session = new wasm.Session();

	try {
		if (await restoreRawCache(session, message)) {
			await publishRawDocument(message, session);
			return;
		}
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
		await publishRawDocument(message, session);
		scheduleRawCacheWrite(session, message.cache);
	} catch (error) {
		session.free();
		if (document?.kind === 'raw' && document.session === session) document = null;
		throw error;
	}
}

async function restoreRawCache(
	session: WasmSession,
	message: Extract<Request, { type: 'open-raw' }>
) {
	const file = await message.cache.getFile();
	if (file.size === 0) return false;
	post({
		id: message.id,
		type: 'progress',
		phase: 'reading',
		bytesRead: 0,
		totalBytes: file.size,
		framesDecoded: 0,
		totalFrames: message.frames.length,
		activeFrame: 1
	});
	const bytes = await measureAsync('cache-read', () =>
		readFile(message.cache, file.size, () => {})
	);
	try {
		measure('cache-restore', () =>
			session.restore_cache(new Uint8Array(bytes), message.maxDimension)
		);
		return true;
	} catch {
		await writeFileHandle(message.cache, new Uint8Array());
		return false;
	}
}

async function publishRawDocument(
	message: Extract<Request, { type: 'open-raw' }>,
	session: WasmSession
) {
	document = {
		kind: 'raw',
		session,
		renderer: await createRawRenderer(session),
		lightLut: null
	};
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
}

function scheduleRawCacheWrite(session: WasmSession, cache: FileSystemFileHandle) {
	pendingCacheWrite = { session, cache };
	queueRawCacheWrite();
}

function deferRawCacheWrite(active: ActiveDocument) {
	if (active.kind !== 'raw' || !pendingCacheWrite || pendingCacheWrite.session !== active.session) {
		return;
	}
	queueRawCacheWrite();
}

function queueRawCacheWrite() {
	if (cacheWriteTimer !== null) clearTimeout(cacheWriteTimer);
	cacheWriteTimer = setTimeout(flushRawCacheWrite, RENDER_CACHE_IDLE_DELAY_MS);
}

function flushRawCacheWrite() {
	cacheWriteTimer = null;
	const pending = pendingCacheWrite;
	pendingCacheWrite = null;
	if (!pending || document?.kind !== 'raw' || document.session !== pending.session) return;
	const bytes = pending.session.cache_bytes();
	void measureAsync('cache-write', () => writeFileHandle(pending.cache, bytes)).catch(() => {});
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
	const light = new wasm.DisplayTransform(...lightArguments(message.settings));
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

function renderRawPreview(session: WasmSession, settings: LightSettings, tone: boolean) {
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
	const developed = await renderDevelopedTile(active, request);
	if (maskCompositors.length === 0) return developed;
	try {
		return compositeDevelopedTile(active, developed, request);
	} catch {
		return developed;
	}
}

async function renderDevelopedTile(active: ActiveDocument, request: RenderTileRequest) {
	if (active.kind === 'raw') {
		if (active.renderer) {
			const key = rawTileKey(request);
			let tile: ReturnType<WasmSession['render_tile_linear']> | null = null;
			try {
				let source: LinearTileSource | null = null;
				if (!active.renderer.hasSource(key)) {
					tile = active.session.render_tile_linear(
						request.x,
						request.y,
						request.width,
						request.height,
						request.bin
					);
					source = { rgba: tile.rgba, width: tile.width, height: tile.height };
				}
				return await active.renderer.render(
					key,
					source,
					request.settings,
					request.tone,
					rawLightLut(active, request.settings)
				);
			} catch {
				active.renderer.destroy();
				active.renderer = null;
			} finally {
				tile?.free();
			}
		}
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

const OPFS_IO_CHUNK_SIZE = 4 * 1024 * 1024;
const READ_PROGRESS_STEP = OPFS_IO_CHUNK_SIZE;
const RENDER_CACHE_IDLE_DELAY_MS = 5_000;

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
	clearMaskCompositors();
	if (cacheWriteTimer !== null) {
		clearTimeout(cacheWriteTimer);
		cacheWriteTimer = null;
	}
	pendingCacheWrite = null;
	if (document?.kind === 'raw') {
		document.renderer?.destroy();
		document.session.free();
	}
	if (document?.kind === 'display') {
		document.light.free();
		document.bitmap.close();
	}
	document = null;
}

function setMaskCompositors(masks: DevelopedMaskInput[]) {
	const next = createMaskCompositors(masks);
	clearMaskCompositors();
	maskCompositors = next;
}

function createMaskCompositors(masks: DevelopedMaskInput[]) {
	const created: typeof maskCompositors = [];
	try {
		for (const mask of masks) {
			const adjusted = adjustMaskEdges(
				{
					width: mask.width,
					height: mask.height,
					alpha: new Uint8Array(mask.alpha)
				},
				mask.edge
			);
			created.push({
				id: mask.id,
				compositor: new wasm.DevelopedTileCompositor(
					adjusted.alpha,
					mask.width,
					mask.height,
					...lightArguments(mask.settings)
				)
			});
		}
		return created;
	} catch (error) {
		for (const mask of created) mask.compositor.free();
		throw error;
	}
}

function clearMaskCompositors() {
	for (const mask of maskCompositors) mask.compositor.free();
	maskCompositors = [];
}

function compositeDevelopedTile(
	active: ActiveDocument,
	developed: ImageBitmap,
	request: RenderTileRequest
) {
	const context = canvasContext(developed.width, developed.height, false);
	context.drawImage(developed, 0, 0);
	let rgba: Uint8Array = new Uint8Array(
		context.getImageData(0, 0, developed.width, developed.height).data
	);
	const imageWidth = active.kind === 'raw' ? active.session.width() : active.bitmap.width;
	const imageHeight = active.kind === 'raw' ? active.session.height() : active.bitmap.height;
	for (const mask of maskCompositors) {
		rgba = mask.compositor.composite_rgba(
			rgba,
			developed.width,
			developed.height,
			imageWidth,
			imageHeight,
			request.x,
			request.y,
			request.width,
			request.height
		);
	}
	context.putImageData(imageData(rgba, developed.width, developed.height), 0, 0);
	const composited = context.canvas.transferToImageBitmap();
	developed.close();
	return composited;
}

const EXPORT_TILE_SIZE = 1024;

function exportDocument(active: ActiveDocument, request: Extract<Request, { type: 'export' }>) {
	const progress = (phase: ExportPhase, completed: number, total: number) =>
		post({ id: request.id, type: 'export-progress', phase, completed, total });
	progress('decode', 0, 1);
	const width = active.kind === 'raw' ? active.session.width() : active.bitmap.width;
	const height = active.kind === 'raw' ? active.session.height() : active.bitmap.height;
	progress('decode', 1, 1);
	const developed = developExportImage(active, width, height, request, (completed, total) =>
		progress('develop', completed, total)
	);
	const framed = applyExportGeometry(developed, width, height, request.geometry);
	progress('encode', 0, 1);
	const quality = Math.min(100, Math.max(1, Math.round(request.quality)));
	const jpeg = wasm.encode_export_jpeg(framed.rgba, framed.width, framed.height, quality);
	return jpeg.buffer as ArrayBuffer;
}

function developExportImage(
	active: ActiveDocument,
	width: number,
	height: number,
	request: Extract<Request, { type: 'export' }>,
	onProgress: (completed: number, total: number) => void
) {
	const light = active.kind === 'display' ? displayTransform(active, request.settings) : null;
	const compositors = createMaskCompositors(request.masks);
	try {
		const rgba = new Uint8Array(width * height * 4);
		const tiles = exportTiles(width, height, EXPORT_TILE_SIZE);
		onProgress(0, tiles.length);
		for (const [index, region] of tiles.entries()) {
			let tile =
				active.kind === 'raw'
					? developRawExportTile(active.session, request.settings, region)
					: developDisplayExportTile(active.bitmap, light!, region);
			for (const mask of compositors) {
				tile = mask.compositor.composite_rgba(
					tile,
					region.width,
					region.height,
					width,
					height,
					region.x,
					region.y,
					region.width,
					region.height
				);
			}
			blitExportTile(rgba, width, tile, region);
			onProgress(index + 1, tiles.length);
		}
		return rgba;
	} finally {
		for (const mask of compositors) mask.compositor.free();
	}
}

function developRawExportTile(session: WasmSession, settings: LightSettings, region: ExportRegion) {
	const tile = session.render_tile(
		region.x,
		region.y,
		region.width,
		region.height,
		1,
		...lightArguments(settings),
		true
	);
	try {
		return tile.rgba;
	} finally {
		tile.free();
	}
}

function developDisplayExportTile(
	bitmap: ImageBitmap,
	light: WasmDisplayTransform,
	region: ExportRegion
) {
	const context = canvasContext(region.width, region.height);
	context.drawImage(
		bitmap,
		region.x,
		region.y,
		region.width,
		region.height,
		0,
		0,
		region.width,
		region.height
	);
	const pixels = context.getImageData(0, 0, region.width, region.height);
	return light.apply_rgba(new Uint8Array(pixels.data.buffer));
}

function blitExportTile(
	target: Uint8Array,
	imageWidth: number,
	tile: Uint8Array,
	region: ExportRegion
) {
	for (let row = 0; row < region.height; row += 1) {
		target.set(
			tile.subarray(row * region.width * 4, (row + 1) * region.width * 4),
			((region.y + row) * imageWidth + region.x) * 4
		);
	}
}

function applyExportGeometry(
	rgba: Uint8Array,
	width: number,
	height: number,
	geometry: ExportGeometry
) {
	if (identityGeometry(geometry)) return { rgba, width, height };
	const source = canvasContext(width, height, false);
	source.putImageData(imageData(rgba, width, height), 0, 0);
	const bounds = rotatedBounds(width, height, geometry.rotation);
	const framed = canvasContext(bounds.width, bounds.height);
	framed.imageSmoothingEnabled = true;
	framed.imageSmoothingQuality = 'high';
	framed.translate(bounds.width / 2, bounds.height / 2);
	framed.rotate((geometry.rotation * Math.PI) / 180);
	framed.scale(geometry.flipHorizontal ? -1 : 1, geometry.flipVertical ? -1 : 1);
	framed.drawImage(source.canvas, -width / 2, -height / 2);
	const crop = cropRegion(bounds.width, bounds.height, geometry.crop);
	const pixels = framed.getImageData(crop.x, crop.y, crop.width, crop.height);
	return { rgba: new Uint8Array(pixels.data.buffer), width: crop.width, height: crop.height };
}

async function createRawRenderer(session: WasmSession) {
	const profile = session.render_profile();
	try {
		return await RawWebGpuRenderer.create({
			transferLut: profile.transfer_lut,
			transferLutLength: profile.transfer_lut_length,
			mix: profile.mix,
			lookupLowBits: profile.lookup_low_bits,
			lookupShift: profile.lookup_shift,
			radianceMax: profile.radiance_max
		} satisfies RawRenderProfile);
	} catch {
		return null;
	} finally {
		profile.free();
	}
}

function rawTileKey(tile: RenderTileRequest) {
	return `${tile.x}:${tile.y}:${tile.width}:${tile.height}:${tile.bin}`;
}

function rawLightLut(active: RawDocument, settings: LightSettings) {
	const key = [
		settings.contrast,
		settings.highlights,
		settings.shadows,
		settings.whites,
		settings.blacks
	].join(':');
	if (active.lightLut?.key === key) return active.lightLut.values;
	const transform = new wasm.DisplayTransform(
		0,
		settings.contrast,
		settings.highlights,
		settings.shadows,
		settings.whites,
		settings.blacks
	);
	try {
		const values = transform.luminance_lut;
		active.lightLut = { key, values };
		return values;
	} finally {
		transform.free();
	}
}

async function writeFileHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
	const syncHandle = handle as FileSystemFileHandle & {
		createSyncAccessHandle?: () => Promise<{
			write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
			truncate: (size: number) => void;
			flush: () => void;
			close: () => void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle === 'function') {
		const access = await syncHandle.createSyncAccessHandle();
		try {
			access.truncate(0);
			let offset = 0;
			while (offset < bytes.byteLength) {
				const chunkEnd = Math.min(offset + OPFS_IO_CHUNK_SIZE, bytes.byteLength);
				while (offset < chunkEnd) {
					const written = access.write(bytes.subarray(offset, chunkEnd), { at: offset });
					if (written === 0) throw new Error(`Unable to write ${handle.name}`);
					offset += written;
				}
				await yieldToWorker();
			}
			access.flush();
		} finally {
			access.close();
		}
		return;
	}
	const writable = await handle.createWritable();
	try {
		for (let offset = 0; offset < bytes.byteLength; offset += OPFS_IO_CHUNK_SIZE) {
			const chunk = new Uint8Array(
				bytes.subarray(offset, Math.min(offset + OPFS_IO_CHUNK_SIZE, bytes.byteLength))
			);
			await writable.write(chunk);
			await yieldToWorker();
		}
		await writable.close();
	} catch (error) {
		await writable.abort();
		throw error;
	}
}

function yieldToWorker() {
	return new Promise<void>((resolve) => setTimeout(resolve, 0));
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
