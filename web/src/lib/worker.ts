import init, { Session } from './pf/postframe.js';
import wasmUrl from './pf/postframe_bg.wasm?url';

export type Request =
	| { type: 'load'; frames: { raf: ArrayBuffer; jpeg?: ArrayBuffer }[] }
	| { type: 'preview'; ev: number; tone: boolean }
	| { type: 'ultra' }
	| { type: 'export' };

export type Response =
	| { type: 'progress'; text: string }
	| { type: 'merged'; boostStops: number }
	| { type: 'preview'; jpeg: ArrayBuffer }
	| { type: 'ultra'; jpeg: ArrayBuffer }
	| { type: 'export'; jpeg: ArrayBuffer }
	| { type: 'error'; message: string };

const ready = init({ module_or_path: wasmUrl });
let session: Session | null = null;

const post = (message: Response, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<Request>) => {
	await ready;
	const message = event.data;
	try {
		switch (message.type) {
			case 'load': {
				session?.free();
				session = new Session();
				let done = 0;
				for (const frame of message.frames) {
					post({ type: 'progress', text: `decoding frame ${++done} of ${message.frames.length}` });
					session.add_frame(
						new Uint8Array(frame.raf),
						frame.jpeg ? new Uint8Array(frame.jpeg) : undefined
					);
				}
				post({ type: 'progress', text: 'aligning and merging' });
				session.merge(2048);
				post({ type: 'merged', boostStops: session.boost_stops() });
				break;
			}
			case 'preview': {
				const jpeg = session!.preview_jpeg(message.ev, message.tone).buffer as ArrayBuffer;
				post({ type: 'preview', jpeg }, [jpeg]);
				break;
			}
			case 'ultra': {
				const jpeg = session!.preview_ultra().buffer as ArrayBuffer;
				post({ type: 'ultra', jpeg }, [jpeg]);
				break;
			}
			case 'export': {
				const jpeg = session!.export_ultra().buffer as ArrayBuffer;
				post({ type: 'export', jpeg }, [jpeg]);
				break;
			}
		}
	} catch (error) {
		post({ type: 'error', message: String(error) });
	}
};
