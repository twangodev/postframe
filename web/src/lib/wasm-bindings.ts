import type { Session } from './pf/postframe.js';
import type { Request } from './worker';

type SessionMethod = Extract<keyof Session, string>;
type WorkerRequest = Request['type'];

interface WasmBinding {
	rust: string;
	worker: WorkerRequest | null;
}

export const WASM_BINDINGS = {
	constructor: { rust: 'Session::new', worker: 'load' },
	free: { rust: 'wasm-bindgen Session destructor', worker: 'load' },
	add_frame: { rust: 'Session::add_frame', worker: 'load' },
	frame_count: { rust: 'Session::frame_count', worker: null },
	merge: { rust: 'Session::merge', worker: 'load' },
	boost_stops: { rust: 'Session::boost_stops', worker: 'load' },
	preview_jpeg: { rust: 'Session::preview_jpeg', worker: 'preview' },
	preview_ultra: { rust: 'Session::preview_ultra', worker: 'ultra' },
	export_ultra: { rust: 'Session::export_ultra', worker: 'export' }
} as const satisfies Record<SessionMethod | 'constructor', WasmBinding>;

type WasmBindingName = keyof typeof WASM_BINDINGS;

interface ImplementationTodo {
	scope: string;
	bindings: readonly WasmBindingName[];
	planned: readonly string[];
}

export const WASM_TODOS = {
	collectionStorage: {
		scope: 'Persist collections, originals, catalog data, and non-destructive edits in OPFS.',
		bindings: ['constructor', 'add_frame'],
		planned: ['browser OPFS catalog']
	},
	photoIngest: {
		scope: 'Decode imported files, pair RAF and JPEG frames, merge brackets, and build thumbnails.',
		bindings: ['constructor', 'free', 'add_frame', 'frame_count', 'merge', 'boost_stops'],
		planned: ['Session::add_photo', 'Session::thumbnail']
	},
	previewRendering: {
		scope: 'Replace object URLs and CSS mock overlays with rendered SDR and Ultra HDR previews.',
		bindings: ['preview_jpeg', 'preview_ultra'],
		planned: ['Session::render_preview']
	},
	adjustments: {
		scope: 'Apply global and masked adjustments to the render graph.',
		bindings: ['preview_jpeg'],
		planned: ['Session::set_adjustments', 'Session::set_mask_adjustments']
	},
	editorTools: {
		scope: 'Execute selection, crop, retouch, paint, type, vector, and measurement tools.',
		bindings: [],
		planned: ['Session::begin_tool', 'Session::update_tool', 'Session::commit_tool']
	},
	masks: {
		scope: 'Create, rasterize, combine, toggle, and delete brush, gradient, and semantic masks.',
		bindings: [],
		planned: ['Session::create_mask', 'Session::update_mask', 'Session::delete_mask']
	},
	layersAndHistory: {
		scope: 'Back layers, blend modes, undo, redo, and history snapshots with the render graph.',
		bindings: [],
		planned: ['Session::add_layer', 'Session::update_layer', 'Session::undo', 'Session::redo']
	},
	metadata: {
		scope: 'Read real capture, camera, lens, exposure, dimensions, histogram, and color data.',
		bindings: ['add_frame'],
		planned: ['Session::frame_metadata', 'Session::histogram']
	},
	generative: {
		scope: 'Run a model-backed edit and composite its result into the active document.',
		bindings: [],
		planned: ['model provider', 'Session::composite']
	},
	export: {
		scope: 'Render and download the selected format, color space, quality, and dimensions.',
		bindings: ['export_ultra'],
		planned: ['Session::export']
	}
} as const satisfies Record<string, ImplementationTodo>;
