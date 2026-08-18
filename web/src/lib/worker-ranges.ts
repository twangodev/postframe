import { wasm } from './worker-wasm.ts';
import type { RangeComponentInput } from './worker-protocol.ts';

export function rasterizeRange(source: ImageData, component: RangeComponentInput): Uint8Array {
	const rgba = new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength);
	return component.type === 'luminance-range'
		? wasm.luminance_range_mask(rgba, source.width, source.height, component.range)
		: wasm.color_range_mask(rgba, source.width, source.height, component.range);
}
