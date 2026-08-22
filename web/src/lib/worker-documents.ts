import { freeQuietly, reportError } from './diagnostics.ts';
import { cloneDevelopSettings, type DevelopSettings } from './develop-settings';
import { cloneCrop, type NormalizedCrop } from './edit-document.ts';
import type { WasmDisplayTransform, WasmSession } from './wasm-runtime';
import { exportMetadataSource } from './export.ts';
import { RawWebGpuRenderer, type DevelopLuts, type RawRenderProfile } from './webgpu-renderer.ts';
import { post, type DevelopPhase, type FileSource, type Request } from './worker-protocol.ts';
import { wasm } from './worker-wasm.ts';
import { measure, measureAsync } from './worker-performance.ts';
import { fileName, fileSize, readFile, sourceFile, writeFileHandle } from './worker-files.ts';
import { displayPreview, renderDisplayPreview, renderRawPreview } from './worker-render.ts';
import { clearMaskCompositors } from './worker-masks.ts';
import { applyCameraMatchSettings, cameraMatchResultSchema } from './camera-match.ts';

export interface SourceImageMemo {
	maxDimension: number;
	image: ImageData;
}

export interface RawDocument {
	kind: 'raw';
	image: { width: number; height: number };
	session: WasmSession;
	renderer: RawWebGpuRenderer | null;
	developLuts: (DevelopLuts & { key: string }) | null;
	metadataSource: FileSource | null;
	sourceImage: SourceImageMemo | null;
}

export interface DisplayDocument {
	kind: 'display';
	source: FileSource;
	bitmap: ImageBitmap;
	preview: ImageData;
	adjustments: DevelopSettings;
	crop: NormalizedCrop | null;
	light: WasmDisplayTransform;
	adjusted: Uint8Array | null;
	sourceImage: SourceImageMemo | null;
}

export type ActiveDocument = RawDocument | DisplayDocument;

const RENDER_CACHE_IDLE_DELAY_MS = 5_000;

let document: ActiveDocument | null = null;
let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCacheWrite: { session: WasmSession; cache: FileSystemFileHandle } | null = null;

export function activeDocument() {
	if (!document) throw new Error('Open a document before rendering');
	return document;
}

export function activeRawDocument() {
	const active = activeDocument();
	if (active.kind !== 'raw') throw new Error('This operation requires a RAW document');
	return active.session;
}

export function closeDocument() {
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

export async function openRawDocument(message: Extract<Request, { type: 'open-raw' }>) {
	closeDocument();
	let session = new wasm.Session();

	try {
		const restore = await restoreRawCache(session, message);
		if (restore === 'restored') {
			await publishRawDocument(message, session);
			return;
		}
		if (restore === 'poisoned') session = replacePoisonedSession(session);
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
				fileName(frame.raw)
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
						fileName(frame.jpeg)
					)
				: undefined;
			progress('decoding', activeFrame);
			measure(
				'raw-decode',
				() => session.add_frame(new Uint8Array(raw), jpeg ? new Uint8Array(jpeg) : undefined),
				fileName(frame.raw)
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
		freeQuietly('open-raw', session);
		if (document?.kind === 'raw' && document.session === session) document = null;
		throw error;
	}
}

type CacheRestore = 'restored' | 'absent' | 'poisoned';

async function restoreRawCache(
	session: WasmSession,
	message: Extract<Request, { type: 'open-raw' }>
): Promise<CacheRestore> {
	const file = await message.cache.getFile();
	if (file.size === 0) return 'absent';
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
		return 'restored';
	} catch (error) {
		reportError('discarding a render cache this build cannot read', error);
		await writeFileHandle(message.cache, new Uint8Array());
		return 'poisoned';
	}
}

function replacePoisonedSession(poisoned: WasmSession) {
	freeQuietly('unreadable render cache', poisoned);
	return new wasm.Session();
}

async function publishRawDocument(
	message: Extract<Request, { type: 'open-raw' }>,
	session: WasmSession
) {
	session.set_camera_look(message.cameraLook);
	const cameraMatch =
		message.cameraMatch !== 'none'
			? cameraMatchResultSchema.parse(session.camera_match())
			: undefined;
	if (cameraMatch && message.cameraMatch === 'apply')
		session.set_camera_look(cameraMatch.cameraLook);
	const adjustments =
		cameraMatch && message.cameraMatch === 'apply'
			? applyCameraMatchSettings(message.adjustments, cameraMatch)
			: message.adjustments;
	document = {
		kind: 'raw',
		image: { width: session.width(), height: session.height() },
		session,
		renderer: await createRawRenderer(session),
		developLuts: null,
		metadataSource: exportMetadataSource(message.frames),
		sourceImage: null
	};
	const preview = measure('preview', () =>
		renderRawPreview(session, adjustments, message.crop, true)
	);
	post(
		{
			id: message.id,
			type: 'opened',
			image: preview.image,
			mediaType: preview.mediaType,
			scope: preview.scope,
			boostStops: session.boost_stops(),
			width: session.width(),
			height: session.height(),
			...(cameraMatch ? { cameraMatch } : {})
		},
		preview.transfer
	);
}

function scheduleRawCacheWrite(session: WasmSession, cache: FileSystemFileHandle) {
	pendingCacheWrite = { session, cache };
	queueRawCacheWrite();
}

export function applyCameraLook(amount: number) {
	const active = document;
	if (active?.kind !== 'raw') return;
	active.session.set_camera_look(amount);
	if (!active.renderer) return;
	const profile = active.session.render_profile();
	try {
		active.renderer.setTransfer(profile.transfer_lut, profile.mix);
	} finally {
		freeQuietly('render profile', profile);
	}
}

export function deriveCameraMatch() {
	return cameraMatchResultSchema.parse(activeRawDocument().camera_match());
}

export function deferRawCacheWrite(active: ActiveDocument) {
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
	void measureAsync('cache-write', () => writeFileHandle(pending.cache, bytes))
		.then(() => post({ id: 0, type: 'storage-written' }))
		.catch(() => {});
}

export async function openDisplayDocument(message: Extract<Request, { type: 'open-display' }>) {
	closeDocument();
	const source = await sourceFile(message.source);
	postDisplayProgress(message, 'reading', 0, source.size);
	const bitmap = await measureAsync(
		'display-decode',
		() => createImageBitmap(source, { imageOrientation: 'from-image' }),
		source.name
	);
	const light = new wasm.DisplayTransform(message.adjustments, message.crop);
	try {
		postDisplayProgress(message, 'decoding', source.size, source.size);
		const preview = displayPreview(bitmap, message.maxDimension);
		const next = {
			kind: 'display',
			source: message.source,
			bitmap,
			preview,
			adjustments: cloneDevelopSettings(message.adjustments),
			crop: cloneCrop(message.crop),
			light,
			adjusted: null,
			sourceImage: null
		} satisfies DisplayDocument;
		document = next;
		postDisplayProgress(message, 'rendering', source.size, source.size);
		const rendered = await measureAsync('preview', () =>
			renderDisplayPreview(next, message.adjustments, message.crop)
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
		freeQuietly('open-display', light);
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
	} catch (error) {
		reportError('webgpu renderer unavailable; using the cpu tile path', error);
		return null;
	} finally {
		freeQuietly('render profile', profile);
	}
}
