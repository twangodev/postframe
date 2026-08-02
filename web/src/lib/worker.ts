import init, {
	Session,
	inspect_raw,
	supported_raw_extensions,
	validate_raw
} from './pf/postframe.js';
import wasmUrl from './pf/postframe_bg.wasm?url';

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

export interface RenderTileRequest {
	x: number;
	y: number;
	width: number;
	height: number;
	bin: number;
	ev: number;
	tone: boolean;
}

export type Request =
	| { id: number; type: 'capabilities' }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| { id: number; type: 'open'; frames: RawFrameHandleInput[]; maxDimension: number }
	| ({ id: number; type: 'tile' } & RenderTileRequest)
	| { id: number; type: 'preview'; ev: number; tone: boolean }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'export' }
	| { id: number; type: 'close' };

export type Response =
	| {
			id: number;
			type: 'progress';
			phase: DevelopPhase;
			bytesRead: number;
			totalBytes: number;
			framesDecoded: number;
			totalFrames: number;
			activeFrame: number;
	  }
	| { id: number; type: 'capabilities'; rawExtensions: string[] }
	| { id: number; type: 'validated' }
	| { id: number; type: 'inspected'; inspection: RawInspection }
	| {
			id: number;
			type: 'opened';
			jpeg: ArrayBuffer;
			boostStops: number;
			width: number;
			height: number;
	  }
	| { id: number; type: 'tile'; png: ArrayBuffer }
	| { id: number; type: 'preview'; jpeg: ArrayBuffer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
	| { id: number; type: 'closed' }
	| { id: number; type: 'error'; message: string };

const ready = init({ module_or_path: wasmUrl });
let session: Session | null = null;

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
				validate_raw(new Uint8Array(message.raw));
				post({ id: message.id, type: 'validated' });
				break;
			case 'inspect': {
				const result = inspect_raw(new Uint8Array(message.raw), message.maxDimension);
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
				break;
			}
			case 'open':
				await openDocument(message);
				break;
			case 'tile': {
				const png = activeSession().render_tile_png(
					message.x,
					message.y,
					message.width,
					message.height,
					message.bin,
					message.ev,
					message.tone
				).buffer as ArrayBuffer;
				post({ id: message.id, type: 'tile', png }, [png]);
				break;
			}
			case 'preview': {
				const jpeg = activeSession().preview_jpeg(message.ev, message.tone).buffer as ArrayBuffer;
				post({ id: message.id, type: 'preview', jpeg }, [jpeg]);
				break;
			}
			case 'ultra': {
				const jpeg = activeSession().preview_ultra().buffer as ArrayBuffer;
				post({ id: message.id, type: 'ultra', jpeg }, [jpeg]);
				break;
			}
			case 'export': {
				const jpeg = activeSession().export_ultra().buffer as ArrayBuffer;
				post({ id: message.id, type: 'export', jpeg }, [jpeg]);
				break;
			}
			case 'close':
				session?.free();
				session = null;
				post({ id: message.id, type: 'closed' });
				break;
		}
	} catch (error) {
		post({ id: message.id, type: 'error', message: String(error) });
	}
};

async function openDocument(message: Extract<Request, { type: 'open' }>) {
	session?.free();
	session = null;
	const next = new Session();

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
			const raw = await readFile(frame.raw, sizes[index].raw, (completed) => {
				bytesRead = frameStart + completed;
				progress('reading', activeFrame);
			});
			const jpegStart = bytesRead;
			const jpeg = frame.jpeg
				? await readFile(frame.jpeg, sizes[index].jpeg, (completed) => {
						bytesRead = jpegStart + completed;
						progress('reading', activeFrame);
					})
				: undefined;
			progress('decoding', activeFrame);
			next.add_frame(new Uint8Array(raw), jpeg ? new Uint8Array(jpeg) : undefined);
			framesDecoded = activeFrame;
			progress('decoding', activeFrame);
		}

		progress('merging', message.frames.length);
		next.merge(message.maxDimension);
		progress('rendering', message.frames.length);
		const jpeg = next.preview_jpeg(0, true).buffer as ArrayBuffer;
		const boostStops = next.boost_stops();
		const width = next.width();
		const height = next.height();
		session = next;
		post({ id: message.id, type: 'opened', jpeg, boostStops, width, height }, [jpeg]);
	} catch (error) {
		next.free();
		throw error;
	}
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

function activeSession() {
	if (!session) throw new Error('Open a document before rendering');
	return session;
}
