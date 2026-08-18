/* tslint:disable */
/* eslint-disable */

export class DevelopedTileCompositor {
    free(): void;
    [Symbol.dispose](): void;
    composite_rgba(rgba: Uint8Array, tile_width: number, tile_height: number, image_width: number, image_height: number, x: number, y: number, width: number, height: number): Uint8Array;
    constructor(mask: Uint8Array, mask_width: number, mask_height: number, settings: any);
}

export class DisplayTransform {
    free(): void;
    [Symbol.dispose](): void;
    apply_rgba(rgba: Uint8Array, width: number, height: number): Uint8Array;
    /**
     * Develop one tile of a display document, told where in the image it sits.
     */
    apply_tile_rgba(rgba: Uint8Array, tile_width: number, tile_height: number, region: any): Uint8Array;
    constructor(settings: any, crop: any);
    /**
     * The red, green and blue curves back to back, empty while all three are
     * the identity.
     */
    readonly channel_luts: Float32Array;
    readonly grading_scalars: Float32Array;
    readonly luminance_lut: Float32Array;
    readonly mixer_luts: Float32Array;
}

export class LinearTile {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The fine plane followed by the coarse one, empty when no stage reads them.
     */
    readonly detail: Float32Array;
    readonly height: number;
    readonly rgba: Float32Array;
    readonly width: number;
}

export class PreviewFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly histogram: Uint32Array;
    readonly jpeg: Uint8Array;
    readonly sample_count: number;
    readonly waveform: Uint16Array;
    readonly waveform_height: number;
    readonly waveform_width: number;
}

export class RawInspection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly camera_make: string | undefined;
    readonly camera_model: string | undefined;
    readonly captured_at: string | undefined;
    readonly exposure_seconds: number | undefined;
    readonly f_number: number | undefined;
    readonly focal_length_mm: number | undefined;
    readonly height: number;
    readonly iso: number | undefined;
    readonly lens: string | undefined;
    readonly orientation: number;
    readonly thumbnail_jpeg: Uint8Array;
    readonly width: number;
}

export class RenderProfile {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly lookup_low_bits: number;
    readonly lookup_shift: number;
    readonly mix: Float32Array;
    readonly radiance_max: number;
    readonly transfer_lut: Float32Array;
    readonly transfer_lut_length: number;
}

export class RenderedTile {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly rgba: Uint8Array;
    readonly width: number;
}

export class ScopeFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly histogram: Uint32Array;
    readonly sample_count: number;
    readonly waveform: Uint16Array;
    readonly waveform_height: number;
    readonly waveform_width: number;
}

export class Session {
    free(): void;
    [Symbol.dispose](): void;
    add_frame(raw: Uint8Array, jpeg?: Uint8Array | null): void;
    boost_stops(): number;
    cache_bytes(): Uint8Array;
    /**
     * Ultra HDR JPEG at the merged resolution.
     */
    export_ultra(): Uint8Array;
    frame_count(): number;
    height(): number;
    merge(preview_dimension: number): void;
    constructor();
    preview_frame(settings: any, crop: any, tone: boolean): PreviewFrame;
    /**
     * Interactive preview: SDR JPEG at the thumbnail size, LUT-rendered.
     */
    preview_jpeg(settings: any, crop: any, tone: boolean): Uint8Array;
    preview_scope(settings: any, crop: any, tone: boolean, sample_target: number): ScopeFrame;
    /**
     * Ultra HDR JPEG at the thumbnail size, for HDR-capable display.
     */
    preview_ultra(): Uint8Array;
    render_profile(): RenderProfile;
    render_tile(x: number, y: number, width: number, height: number, bin: number, settings: any, crop: any, tone: boolean): RenderedTile;
    render_tile_linear(x: number, y: number, width: number, height: number, bin: number, settings: any): LinearTile;
    restore_cache(cache: Uint8Array, preview_dimension: number): void;
    width(): number;
}

/**
 * One alpha byte per pixel: how far each encoded RGBA pixel's hue and chroma
 * fall inside a colour range.
 */
export function color_range_mask(rgba: Uint8Array, width: number, height: number, range: any): Uint8Array;

export function encode_export_jpeg(rgba: Uint8Array, width: number, height: number, quality: number, original?: Uint8Array | null): Uint8Array;

export function initThreadPool(num_threads: number): Promise<any>;

export function inspect_raw(raw: Uint8Array, thumbnail_dimension: number): RawInspection;

/**
 * One alpha byte per pixel: how far each encoded RGBA pixel's luma falls
 * inside a luminance range.
 */
export function luminance_range_mask(rgba: Uint8Array, width: number, height: number, range: any): Uint8Array;

export function supported_raw_extensions(): string[];

export function validate_raw(raw: Uint8Array): void;

export class wbg_rayon_PoolBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): void;
    numThreads(): number;
    receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_lineartile_free: (a: number, b: number) => void;
    readonly __wbg_previewframe_free: (a: number, b: number) => void;
    readonly __wbg_renderedtile_free: (a: number, b: number) => void;
    readonly __wbg_renderprofile_free: (a: number, b: number) => void;
    readonly __wbg_scopeframe_free: (a: number, b: number) => void;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly encode_export_jpeg: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly lineartile_detail: (a: number) => [number, number];
    readonly lineartile_height: (a: number) => number;
    readonly lineartile_rgba: (a: number) => [number, number];
    readonly lineartile_width: (a: number) => number;
    readonly previewframe_histogram: (a: number) => [number, number];
    readonly previewframe_jpeg: (a: number) => [number, number];
    readonly previewframe_sample_count: (a: number) => number;
    readonly previewframe_waveform: (a: number) => [number, number];
    readonly previewframe_waveform_height: (a: number) => number;
    readonly previewframe_waveform_width: (a: number) => number;
    readonly renderedtile_height: (a: number) => number;
    readonly renderedtile_rgba: (a: number) => [number, number];
    readonly renderedtile_width: (a: number) => number;
    readonly renderprofile_lookup_shift: (a: number) => number;
    readonly renderprofile_mix: (a: number) => [number, number];
    readonly renderprofile_radiance_max: (a: number) => number;
    readonly renderprofile_transfer_lut: (a: number) => [number, number];
    readonly scopeframe_histogram: (a: number) => [number, number];
    readonly scopeframe_waveform: (a: number) => [number, number];
    readonly session_add_frame: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly session_boost_stops: (a: number) => number;
    readonly session_cache_bytes: (a: number) => [number, number, number, number];
    readonly session_export_ultra: (a: number) => [number, number, number, number];
    readonly session_frame_count: (a: number) => number;
    readonly session_height: (a: number) => [number, number, number];
    readonly session_merge: (a: number, b: number) => [number, number];
    readonly session_new: () => number;
    readonly session_preview_frame: (a: number, b: any, c: any, d: number) => [number, number, number];
    readonly session_preview_jpeg: (a: number, b: any, c: any, d: number) => [number, number, number, number];
    readonly session_preview_scope: (a: number, b: any, c: any, d: number, e: number) => [number, number, number];
    readonly session_preview_ultra: (a: number) => [number, number, number, number];
    readonly session_render_profile: (a: number) => [number, number, number];
    readonly session_render_tile: (a: number, b: number, c: number, d: number, e: number, f: number, g: any, h: any, i: number) => [number, number, number];
    readonly session_render_tile_linear: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => [number, number, number];
    readonly session_restore_cache: (a: number, b: number, c: number, d: number) => [number, number];
    readonly session_width: (a: number) => [number, number, number];
    readonly renderprofile_lookup_low_bits: (a: number) => number;
    readonly renderprofile_transfer_lut_length: (a: number) => number;
    readonly scopeframe_sample_count: (a: number) => number;
    readonly scopeframe_waveform_height: (a: number) => number;
    readonly scopeframe_waveform_width: (a: number) => number;
    readonly __wbg_rawinspection_free: (a: number, b: number) => void;
    readonly inspect_raw: (a: number, b: number, c: number) => [number, number, number];
    readonly rawinspection_camera_make: (a: number) => [number, number];
    readonly rawinspection_camera_model: (a: number) => [number, number];
    readonly rawinspection_captured_at: (a: number) => [number, number];
    readonly rawinspection_exposure_seconds: (a: number) => [number, number];
    readonly rawinspection_f_number: (a: number) => [number, number];
    readonly rawinspection_focal_length_mm: (a: number) => [number, number];
    readonly rawinspection_height: (a: number) => number;
    readonly rawinspection_iso: (a: number) => number;
    readonly rawinspection_lens: (a: number) => [number, number];
    readonly rawinspection_orientation: (a: number) => number;
    readonly rawinspection_thumbnail_jpeg: (a: number) => [number, number];
    readonly rawinspection_width: (a: number) => number;
    readonly supported_raw_extensions: () => [number, number];
    readonly validate_raw: (a: number, b: number) => [number, number];
    readonly __wbg_developedtilecompositor_free: (a: number, b: number) => void;
    readonly __wbg_displaytransform_free: (a: number, b: number) => void;
    readonly color_range_mask: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly developedtilecompositor_composite_rgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number, number];
    readonly developedtilecompositor_new: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly displaytransform_apply_rgba: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly displaytransform_apply_tile_rgba: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number, number];
    readonly displaytransform_channel_luts: (a: number) => [number, number];
    readonly displaytransform_grading_scalars: (a: number) => [number, number];
    readonly displaytransform_luminance_lut: (a: number) => [number, number];
    readonly displaytransform_mixer_luts: (a: number) => [number, number];
    readonly displaytransform_new: (a: any, b: any) => [number, number, number];
    readonly luminance_range_mask: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly initThreadPool: (a: number) => any;
    readonly memory: WebAssembly.Memory;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
    readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
