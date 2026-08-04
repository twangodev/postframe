import { threads } from 'wasm-feature-detect';
import initStandard, * as standard from './pf/postframe.js';
import standardUrl from './pf/postframe_bg.wasm?url';

export type WasmModule = typeof standard;
export type WasmSession = InstanceType<WasmModule['Session']>;
export type WasmDisplayTransform = InstanceType<WasmModule['DisplayTransform']>;
export type WasmDevelopedTileCompositor = InstanceType<WasmModule['DevelopedTileCompositor']>;

interface WasmRuntime {
	module: WasmModule;
	threaded: boolean;
	threadCount: number;
}

type ThreadedModule = WasmModule & {
	initThreadPool(threadCount: number): Promise<unknown>;
};

export async function loadWasmRuntime(): Promise<WasmRuntime> {
	if (await supportsThreads()) {
		try {
			const [threaded, threadedUrl] = await Promise.all([
				import('./pf-threaded/postframe.js'),
				import('./pf-threaded/postframe_bg.wasm?url')
			]);
			const module = threaded as unknown as ThreadedModule;
			await module.default({ module_or_path: threadedUrl.default });
			const threadCount = preferredThreadCount();
			await module.initThreadPool(threadCount);
			return { module, threaded: true, threadCount };
		} catch {}
	}

	await initStandard({ module_or_path: standardUrl });
	return { module: standard, threaded: false, threadCount: 1 };
}

async function supportsThreads() {
	return (
		globalThis.crossOriginIsolated === true &&
		typeof SharedArrayBuffer !== 'undefined' &&
		(await threads())
	);
}

function preferredThreadCount() {
	return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
}
