import type { Session } from './pf/postframe.js';
import type { Request } from './worker';

type SessionMethod = Extract<keyof Session, string>;
type WorkerRequest = Request['type'];

interface WasmBinding {
	rust: string;
	worker: WorkerRequest | readonly WorkerRequest[] | null;
}

export const WASM_BINDINGS = {
	supported_raw_extensions: { rust: 'supported_raw_extensions', worker: 'capabilities' },
	validate_raw: { rust: 'validate_raw', worker: 'validate' },
	inspect_raw: { rust: 'inspect_raw', worker: 'inspect' },
	display_transform: {
		rust: 'DisplayTransform::new',
		worker: ['open-display', 'preview', 'tile']
	},
	display_free: {
		rust: 'wasm-bindgen DisplayTransform destructor',
		worker: ['preview', 'tile', 'close']
	},
	apply_display_rgba: {
		rust: 'DisplayTransform::apply_rgba',
		worker: ['open-display', 'preview', 'tile']
	},
	constructor: { rust: 'Session::new', worker: 'open-raw' },
	free: { rust: 'wasm-bindgen Session destructor', worker: 'close' },
	add_frame: { rust: 'Session::add_frame', worker: 'open-raw' },
	frame_count: { rust: 'Session::frame_count', worker: null },
	merge: { rust: 'Session::merge', worker: 'open-raw' },
	boost_stops: { rust: 'Session::boost_stops', worker: 'open-raw' },
	width: { rust: 'Session::width', worker: 'open-raw' },
	height: { rust: 'Session::height', worker: 'open-raw' },
	preview_jpeg: { rust: 'Session::preview_jpeg', worker: null },
	preview_frame: { rust: 'Session::preview_frame', worker: 'preview' },
	render_tile: { rust: 'Session::render_tile', worker: 'tile' },
	preview_ultra: { rust: 'Session::preview_ultra', worker: 'ultra' },
	export_ultra: { rust: 'Session::export_ultra', worker: 'export' }
} as const satisfies Record<
	| SessionMethod
	| 'constructor'
	| 'supported_raw_extensions'
	| 'validate_raw'
	| 'inspect_raw'
	| 'display_transform'
	| 'display_free'
	| 'apply_display_rgba',
	WasmBinding
>;

type WasmBindingName = keyof typeof WASM_BINDINGS;

interface ImplementationTodo {
	scope: string;
	bindings: readonly WasmBindingName[];
	planned: readonly string[];
}

export const WASM_TODOS = {
	libraryStorage: {
		scope: 'Restore the photo library and persist non-destructive render graph edits in OPFS.',
		bindings: ['constructor', 'add_frame'],
		planned: ['collection membership', 'OPFS recovery', 'versioned edit snapshots']
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
			'boost_stops',
			'width',
			'height'
		],
		planned: ['Session::add_photo', 'region-aware RAW demosaic']
	},
	editorCommands: {
		scope: 'Route menus, shortcuts, context menus, and toolbars through one command system.',
		bindings: [],
		planned: ['web EditorCommand dispatcher']
	},
	previewRendering: {
		scope: 'Replace object URLs and CSS mock overlays with rendered SDR and Ultra HDR previews.',
		bindings: ['preview_frame', 'render_tile', 'preview_ultra'],
		planned: ['GPU display transform']
	},
	colorManagement: {
		scope: 'Manage working spaces, embedded profiles, proofing, and display transforms.',
		bindings: ['preview_frame', 'preview_ultra', 'export_ultra'],
		planned: ['Session::set_working_space', 'Session::convert_profile', 'Session::proof_preview']
	},
	adjustments: {
		scope: 'Apply remaining global and masked adjustments to the render graph.',
		bindings: [
			'display_transform',
			'display_free',
			'apply_display_rgba',
			'preview_frame',
			'render_tile'
		],
		planned: ['Session::set_mask_adjustments', 'color and presence controls']
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
		bindings: ['inspect_raw', 'add_frame', 'width', 'height', 'preview_frame'],
		planned: ['display EXIF parser']
	},
	generative: {
		scope: 'Run a model-backed edit and composite its result into the active document.',
		bindings: [],
		planned: ['model provider', 'Session::composite']
	},
	backgroundJobs: {
		scope: 'Queue, report, cancel, and recover long-running decode, render, and export work.',
		bindings: [
			'add_frame',
			'merge',
			'preview_frame',
			'render_tile',
			'preview_ultra',
			'export_ultra'
		],
		planned: ['worker job queue', 'Session::cancel']
	},
	export: {
		scope: 'Render and download the selected format, color space, quality, and dimensions.',
		bindings: ['export_ultra'],
		planned: ['Session::export']
	}
} as const satisfies Record<string, ImplementationTodo>;

export type WasmTodoName = keyof typeof WASM_TODOS;
