import init, { Session } from './pf/postframe.js';
import wasmUrl from './pf/postframe_bg.wasm?url';

export interface RawFrameInput {
	raw: ArrayBuffer;
	jpeg?: ArrayBuffer;
}

export type Request =
	| { id: number; type: 'load'; frames: RawFrameInput[] }
	| { id: number; type: 'preview'; ev: number; tone: boolean }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'export' };

export type Response =
	| { id: number; type: 'progress'; text: string }
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
