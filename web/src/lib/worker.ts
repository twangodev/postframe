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

export type Request =
	| { id: number; type: 'capabilities' }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| { id: number; type: 'open'; frames: RawFrameHandleInput[]; maxDimension: number }
	| { id: number; type: 'preview'; ev: number; tone: boolean }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'export' }
	| { id: number; type: 'close' };

export type Response =
	| {
			id: number;
			type: 'progress';
			phase: DevelopPhase;
			completed: number;
			total: number;
	  }
	| { id: number; type: 'capabilities'; rawExtensions: string[] }
	| { id: number; type: 'validated' }
	| { id: number; type: 'inspected'; inspection: RawInspection }
	| { id: number; type: 'opened'; jpeg: ArrayBuffer; boostStops: number }
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
		for (const [index, frame] of message.frames.entries()) {
			post({
				id: message.id,
				type: 'progress',
				phase: 'reading',
				completed: index,
				total: message.frames.length
			});
			const raw = await readFile(frame.raw);
			const jpeg = frame.jpeg ? await readFile(frame.jpeg) : undefined;
			post({
				id: message.id,
				type: 'progress',
				phase: 'decoding',
				completed: index,
				total: message.frames.length
			});
			next.add_frame(new Uint8Array(raw), jpeg ? new Uint8Array(jpeg) : undefined);
			post({
				id: message.id,
				type: 'progress',
				phase: 'decoding',
				completed: index + 1,
				total: message.frames.length
			});
		}

		post({
			id: message.id,
			type: 'progress',
			phase: 'merging',
			completed: 0,
			total: 1
		});
		next.merge(message.maxDimension);
		post({
			id: message.id,
			type: 'progress',
			phase: 'rendering',
			completed: 0,
			total: 1
		});
		const jpeg = next.preview_jpeg(0, true).buffer as ArrayBuffer;
		const boostStops = next.boost_stops();
		session = next;
		post({ id: message.id, type: 'opened', jpeg, boostStops }, [jpeg]);
	} catch (error) {
		next.free();
		throw error;
	}
}

async function readFile(handle: FileSystemFileHandle) {
	const syncHandle = handle as FileSystemFileHandle & {
		createSyncAccessHandle?: () => Promise<{
			getSize: () => number;
			read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
			close: () => void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle !== 'function') {
		return handle.getFile().then((file) => file.arrayBuffer());
	}

	const access = await syncHandle.createSyncAccessHandle();
	try {
		const bytes = new Uint8Array(access.getSize());
		let offset = 0;
		while (offset < bytes.byteLength) {
			const read = access.read(bytes.subarray(offset), { at: offset });
			if (read === 0) throw new Error(`Unable to finish reading ${handle.name}`);
			offset += read;
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
