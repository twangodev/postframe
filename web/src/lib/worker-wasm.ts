import { loadWasmRuntime, type WasmModule } from './wasm-runtime';

export let wasm: WasmModule;
export let threaded = false;
export let threadCount = 1;

export const ready = loadWasmRuntime().then((runtime) => {
	wasm = runtime.module;
	threaded = runtime.threaded;
	threadCount = runtime.threadCount;
});
