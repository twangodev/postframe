import init, {
	Session,
	inspect_raw,
	supported_raw_extensions,
	validate_raw
} from './pf/postframe.js';
import wasmUrl from './pf/postframe_bg.wasm?url';

export interface RawFrameInput {
	raw: ArrayBuffer;
	jpeg?: ArrayBuffer;
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

export type Request =
	| { id: number; type: 'capabilities' }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| { id: number; type: 'load'; frames: RawFrameInput[] }
	| { id: number; type: 'preview'; ev: number; tone: boolean }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'export' };

export type Response =
	| { id: number; type: 'progress'; text: string }
	| { id: number; type: 'capabilities'; rawExtensions: string[] }
	| { id: number; type: 'validated' }
	| { id: number; type: 'inspected'; inspection: RawInspection }
	| { id: number; type: 'merged'; boostStops: number }
	| { id: number; type: 'preview'; jpeg: ArrayBuffer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
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
			case 'load': {
				session?.free();
				session = new Session();
				let done = 0;
				for (const frame of message.frames) {
					post({
						id: message.id,
						type: 'progress',
						text: `decoding frame ${++done} of ${message.frames.length}`
					});
					session.add_frame(
						new Uint8Array(frame.raw),
						frame.jpeg ? new Uint8Array(frame.jpeg) : undefined
					);
				}
				post({ id: message.id, type: 'progress', text: 'aligning and merging' });
				session.merge(2048);
				post({ id: message.id, type: 'merged', boostStops: session.boost_stops() });
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
		}
	} catch (error) {
		post({ id: message.id, type: 'error', message: String(error) });
	}
};

function activeSession() {
	if (!session) throw new Error('Load RAW frames before rendering');
	return session;
}
