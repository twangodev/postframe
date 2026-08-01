import type { Session } from './pf/postframe.js';
import type { Request } from './worker';

type SessionMethod = Extract<keyof Session, string>;
type WorkerRequest = Request['type'];

interface WasmBinding {
	rust: string;
	worker: WorkerRequest | null;
}

export const WASM_BINDINGS = {
	supported_raw_extensions: { rust: 'supported_raw_extensions', worker: 'capabilities' },
	validate_raw: { rust: 'validate_raw', worker: 'validate' },
	inspect_raw: { rust: 'inspect_raw', worker: 'inspect' },
	constructor: { rust: 'Session::new', worker: 'open' },
	free: { rust: 'wasm-bindgen Session destructor', worker: 'close' },
	add_frame: { rust: 'Session::add_frame', worker: 'open' },
	frame_count: { rust: 'Session::frame_count', worker: null },
	merge: { rust: 'Session::merge', worker: 'open' },
	boost_stops: { rust: 'Session::boost_stops', worker: 'open' },
	preview_jpeg: { rust: 'Session::preview_jpeg', worker: 'preview' },
	preview_ultra: { rust: 'Session::preview_ultra', worker: 'ultra' },
	export_ultra: { rust: 'Session::export_ultra', worker: 'export' }
} as const satisfies Record<
	SessionMethod | 'constructor' | 'supported_raw_extensions' | 'validate_raw' | 'inspect_raw',
	WasmBinding
>;

type WasmBindingName = keyof typeof WASM_BINDINGS;

interface ImplementationTodo {
	scope: string;
	bindings: readonly WasmBindingName[];
	planned: readonly string[];
}

export const WASM_TODOS = {
	collectionStorage: {
		scope: 'Restore saved collections and persist non-destructive render graph edits in OPFS.',
		bindings: ['constructor', 'add_frame'],
		planned: ['collection picker', 'OPFS recovery', 'versioned edit snapshots']
	},
	photoIngest: {
		scope: 'Decode imported files, pair RAW and JPEG frames, merge brackets, and build thumbnails.',
		bindings: [
			'supported_raw_extensions',
			'validate_raw',
			'inspect_raw',
			'constructor',
			'free',
			'add_frame',
			'frame_count',
			'merge',
			'boost_stops'
		],
		planned: ['Session::add_photo']
	},
	editorCommands: {
		scope: 'Route menus, shortcuts, context menus, and toolbars through one command system.',
		bindings: [],
		planned: ['web EditorCommand dispatcher']
	},
	previewRendering: {
		scope: 'Replace object URLs and CSS mock overlays with rendered SDR and Ultra HDR previews.',
		bindings: ['preview_jpeg', 'preview_ultra'],
		planned: ['Session::render_preview']
	},
	colorManagement: {
		scope: 'Manage working spaces, embedded profiles, proofing, and display transforms.',
		bindings: ['preview_jpeg', 'preview_ultra', 'export_ultra'],
		planned: ['Session::set_working_space', 'Session::convert_profile', 'Session::proof_preview']
	},
	adjustments: {
		scope: 'Apply global and masked adjustments to the render graph.',
		bindings: ['preview_jpeg'],
		planned: ['Session::set_adjustments', 'Session::set_mask_adjustments']
	},
	documentGeometry: {
		scope: 'Resize, crop, rotate, distort, warp, and transform document pixels and bounds.',
		bindings: [],
		planned: ['Session::resize', 'Session::resize_canvas', 'Session::transform']
	},
	selections: {
		scope: 'Create, combine, refine, transform, save, and restore pixel selections.',
		bindings: [],
		planned: ['Session::select', 'Session::refine_selection', 'Session::transform_selection']
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
	filters: {
		scope: 'Apply destructive and smart blur, sharpen, noise, lens, and stylize filters.',
		bindings: [],
		planned: ['Session::apply_filter', 'Session::add_smart_filter']
	},
	metadata: {
		scope: 'Read real capture, camera, lens, exposure, dimensions, histogram, and color data.',
		bindings: ['inspect_raw', 'add_frame'],
		planned: ['display EXIF parser', 'Session::histogram']
	},
	generative: {
		scope: 'Run a model-backed edit and composite its result into the active document.',
		bindings: [],
		planned: ['model provider', 'Session::composite']
	},
	backgroundJobs: {
		scope: 'Queue, report, cancel, and recover long-running decode, render, and export work.',
		bindings: ['add_frame', 'merge', 'preview_jpeg', 'preview_ultra', 'export_ultra'],
		planned: ['worker job queue', 'Session::cancel']
	},
	export: {
		scope: 'Render and download the selected format, color space, quality, and dimensions.',
		bindings: ['export_ultra'],
		planned: ['Session::export']
	}
} as const satisfies Record<string, ImplementationTodo>;

export type WasmTodoName = keyof typeof WASM_TODOS;
