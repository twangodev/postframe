import type { WasmTodoName } from './wasm-bindings';

export type EditorMenuAction =
	| 'new-collection'
	| 'import-photos'
	| 'show-organizer'
	| 'save-library'
	| 'export'
	| 'close-library'
	| 'open-github';

interface MenuAction {
	kind: 'action';
	label: string;
	action: EditorMenuAction;
	shortcut?: string;
}

interface MenuTodo {
	kind: 'todo';
	label: string;
	todo: WasmTodoName;
	shortcut?: string;
	checked?: boolean;
}

interface MenuSeparator {
	kind: 'separator';
}

type MenuLeaf = MenuAction | MenuTodo | MenuSeparator;

interface MenuSubmenu {
	kind: 'submenu';
	label: string;
	items: MenuLeaf[];
}

export type EditorMenuEntry = MenuLeaf | MenuSubmenu;

export interface EditorMenu {
	id: string;
	label: string;
	items: EditorMenuEntry[];
}

const separator = (): MenuSeparator => ({ kind: 'separator' });

export const EDITOR_MENUS: EditorMenu[] = [
	{
		id: 'file',
		label: 'file',
		items: [
			{ kind: 'action', label: 'new collection', action: 'new-collection', shortcut: '⌘N' },
			{ kind: 'action', label: 'import photos…', action: 'import-photos', shortcut: '⌘O' },
			{ kind: 'action', label: 'show in organizer', action: 'show-organizer' },
			separator(),
			{ kind: 'action', label: 'save library', action: 'save-library', shortcut: '⌘S' },
			{ kind: 'action', label: 'export…', action: 'export', shortcut: '⇧⌘E' },
			{ kind: 'todo', label: 'export Ultra HDR', todo: 'export' },
			separator(),
			{ kind: 'action', label: 'close library', action: 'close-library', shortcut: '⌘W' }
		]
	},
	{
		id: 'edit',
		label: 'edit',
		items: [
			{ kind: 'todo', label: 'undo', todo: 'layersAndHistory', shortcut: '⌘Z' },
			{ kind: 'todo', label: 'redo', todo: 'layersAndHistory', shortcut: '⇧⌘Z' },
			separator(),
			{ kind: 'todo', label: 'cut', todo: 'layersAndHistory', shortcut: '⌘X' },
			{ kind: 'todo', label: 'copy', todo: 'layersAndHistory', shortcut: '⌘C' },
			{ kind: 'todo', label: 'paste', todo: 'layersAndHistory', shortcut: '⌘V' },
			separator(),
			{
				kind: 'submenu',
				label: 'transform',
				items: [
					{ kind: 'todo', label: 'free transform', todo: 'documentGeometry', shortcut: '⌘T' },
					{ kind: 'todo', label: 'scale', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'rotate', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'skew', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'distort', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'perspective', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'warp', todo: 'documentGeometry' },
					separator(),
					{ kind: 'todo', label: 'rotate 180°', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'rotate 90° clockwise', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'rotate 90° counterclockwise', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'flip horizontal', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'flip vertical', todo: 'documentGeometry' }
				]
			},
			separator(),
			{ kind: 'todo', label: 'content-aware fill…', todo: 'generative' },
			{ kind: 'todo', label: 'generative fill…', todo: 'generative' },
			separator(),
			{ kind: 'todo', label: 'keyboard shortcuts…', todo: 'editorCommands' }
		]
	},
	{
		id: 'image',
		label: 'image',
		items: [
			{
				kind: 'submenu',
				label: 'mode',
				items: [
					{ kind: 'todo', label: 'RGB color', todo: 'colorManagement', checked: true },
					{ kind: 'todo', label: '8 bits/channel', todo: 'colorManagement', checked: true },
					{ kind: 'todo', label: '16 bits/channel', todo: 'colorManagement' }
				]
			},
			{
				kind: 'submenu',
				label: 'adjustments',
				items: [
					{ kind: 'todo', label: 'brightness / contrast…', todo: 'adjustments' },
					{ kind: 'todo', label: 'levels…', todo: 'adjustments', shortcut: '⌘L' },
					{ kind: 'todo', label: 'curves…', todo: 'adjustments', shortcut: '⌘M' },
					{ kind: 'todo', label: 'exposure…', todo: 'adjustments' },
					separator(),
					{ kind: 'todo', label: 'vibrance…', todo: 'adjustments' },
					{ kind: 'todo', label: 'hue / saturation…', todo: 'adjustments', shortcut: '⌘U' },
					{ kind: 'todo', label: 'color balance…', todo: 'adjustments', shortcut: '⌘B' },
					{ kind: 'todo', label: 'black & white…', todo: 'adjustments' }
				]
			},
			separator(),
			{ kind: 'todo', label: 'auto tone', todo: 'adjustments', shortcut: '⇧⌘L' },
			{ kind: 'todo', label: 'auto contrast', todo: 'adjustments' },
			{ kind: 'todo', label: 'auto color', todo: 'adjustments' },
			separator(),
			{ kind: 'todo', label: 'image size…', todo: 'documentGeometry', shortcut: '⌥⌘I' },
			{ kind: 'todo', label: 'canvas size…', todo: 'documentGeometry', shortcut: '⌥⌘C' },
			{ kind: 'todo', label: 'crop', todo: 'documentGeometry' },
			{ kind: 'todo', label: 'trim…', todo: 'documentGeometry' },
			{
				kind: 'submenu',
				label: 'image rotation',
				items: [
					{ kind: 'todo', label: '180°', todo: 'documentGeometry' },
					{ kind: 'todo', label: '90° clockwise', todo: 'documentGeometry' },
					{ kind: 'todo', label: '90° counterclockwise', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'arbitrary…', todo: 'documentGeometry' },
					separator(),
					{ kind: 'todo', label: 'flip canvas horizontal', todo: 'documentGeometry' },
					{ kind: 'todo', label: 'flip canvas vertical', todo: 'documentGeometry' }
				]
			}
		]
	},
	{
		id: 'layer',
		label: 'layer',
		items: [
			{ kind: 'todo', label: 'new layer', todo: 'layersAndHistory', shortcut: '⇧⌘N' },
			{ kind: 'todo', label: 'duplicate layer', todo: 'layersAndHistory', shortcut: '⌘J' },
			{ kind: 'todo', label: 'delete layer', todo: 'layersAndHistory' },
			{
				kind: 'submenu',
				label: 'new adjustment layer',
				items: [
					{ kind: 'todo', label: 'exposure…', todo: 'layersAndHistory' },
					{ kind: 'todo', label: 'curves…', todo: 'layersAndHistory' },
					{ kind: 'todo', label: 'color balance…', todo: 'layersAndHistory' },
					{ kind: 'todo', label: 'hue / saturation…', todo: 'layersAndHistory' }
				]
			},
			separator(),
			{
				kind: 'submenu',
				label: 'layer mask',
				items: [
					{ kind: 'todo', label: 'reveal all', todo: 'masks' },
					{ kind: 'todo', label: 'hide all', todo: 'masks' },
					{ kind: 'todo', label: 'reveal selection', todo: 'masks' },
					{ kind: 'todo', label: 'hide selection', todo: 'masks' },
					separator(),
					{ kind: 'todo', label: 'select and mask…', todo: 'masks' }
				]
			},
			separator(),
			{ kind: 'todo', label: 'group layers', todo: 'layersAndHistory', shortcut: '⌘G' },
			{ kind: 'todo', label: 'merge layers', todo: 'layersAndHistory', shortcut: '⌘E' },
			{ kind: 'todo', label: 'flatten image', todo: 'layersAndHistory' }
		]
	},
	{
		id: 'type',
		label: 'type',
		items: [
			{ kind: 'todo', label: 'add horizontal type', todo: 'editorTools', shortcut: 'T' },
			{ kind: 'todo', label: 'add vertical type', todo: 'editorTools' },
			separator(),
			{ kind: 'todo', label: 'anti-alias', todo: 'editorTools', checked: true },
			{ kind: 'todo', label: 'orientation', todo: 'editorTools' },
			{ kind: 'todo', label: 'convert to shape', todo: 'editorTools' },
			{ kind: 'todo', label: 'rasterize type layer', todo: 'layersAndHistory' }
		]
	},
	{
		id: 'select',
		label: 'select',
		items: [
			{ kind: 'todo', label: 'all', todo: 'selections', shortcut: '⌘A' },
			{ kind: 'todo', label: 'deselect', todo: 'selections', shortcut: '⌘D' },
			{ kind: 'todo', label: 'reselect', todo: 'selections', shortcut: '⇧⌘D' },
			{ kind: 'todo', label: 'inverse', todo: 'selections', shortcut: '⇧⌘I' },
			separator(),
			{ kind: 'todo', label: 'subject', todo: 'selections' },
			{ kind: 'todo', label: 'sky', todo: 'selections' },
			{ kind: 'todo', label: 'select and mask…', todo: 'masks', shortcut: '⌥⌘R' },
			{
				kind: 'submenu',
				label: 'modify',
				items: [
					{ kind: 'todo', label: 'border…', todo: 'selections' },
					{ kind: 'todo', label: 'smooth…', todo: 'selections' },
					{ kind: 'todo', label: 'expand…', todo: 'selections' },
					{ kind: 'todo', label: 'contract…', todo: 'selections' },
					{ kind: 'todo', label: 'feather…', todo: 'selections', shortcut: '⇧F6' }
				]
			},
			{ kind: 'todo', label: 'transform selection', todo: 'selections' },
			separator(),
			{ kind: 'todo', label: 'save selection…', todo: 'selections' },
			{ kind: 'todo', label: 'load selection…', todo: 'selections' }
		]
	},
	{
		id: 'filter',
		label: 'filter',
		items: [
			{ kind: 'todo', label: 'last filter', todo: 'filters', shortcut: '⌘F' },
			{ kind: 'todo', label: 'camera raw filter…', todo: 'filters', shortcut: '⇧⌘A' },
			{ kind: 'todo', label: 'neural filters…', todo: 'generative' },
			{ kind: 'todo', label: 'filter gallery…', todo: 'filters' },
			separator(),
			{
				kind: 'submenu',
				label: 'blur',
				items: [
					{ kind: 'todo', label: 'gaussian blur…', todo: 'filters' },
					{ kind: 'todo', label: 'lens blur…', todo: 'filters' },
					{ kind: 'todo', label: 'motion blur…', todo: 'filters' },
					{ kind: 'todo', label: 'surface blur…', todo: 'filters' }
				]
			},
			{
				kind: 'submenu',
				label: 'sharpen',
				items: [
					{ kind: 'todo', label: 'sharpen', todo: 'filters' },
					{ kind: 'todo', label: 'smart sharpen…', todo: 'filters' },
					{ kind: 'todo', label: 'unsharp mask…', todo: 'filters' }
				]
			},
			{
				kind: 'submenu',
				label: 'noise',
				items: [
					{ kind: 'todo', label: 'reduce noise…', todo: 'filters' },
					{ kind: 'todo', label: 'add noise…', todo: 'filters' },
					{ kind: 'todo', label: 'dust & scratches…', todo: 'filters' }
				]
			},
			{ kind: 'todo', label: 'lens correction…', todo: 'filters' }
		]
	},
	{
		id: 'view',
		label: 'view',
		items: [
			{ kind: 'todo', label: 'zoom in', todo: 'editorCommands', shortcut: '⌘+' },
			{ kind: 'todo', label: 'zoom out', todo: 'editorCommands', shortcut: '⌘−' },
			{ kind: 'todo', label: 'fit on screen', todo: 'editorCommands', shortcut: '⌘0' },
			{ kind: 'todo', label: '100%', todo: 'editorCommands', shortcut: '⌘1' },
			separator(),
			{ kind: 'todo', label: 'before / after', todo: 'previewRendering', shortcut: '\\' },
			{ kind: 'todo', label: 'proof colors', todo: 'colorManagement', shortcut: '⌘Y' },
			separator(),
			{ kind: 'todo', label: 'selection edges', todo: 'selections', checked: true },
			{ kind: 'todo', label: 'mask overlay', todo: 'masks', checked: true },
			{ kind: 'todo', label: 'grid', todo: 'editorCommands' },
			{ kind: 'todo', label: 'guides', todo: 'editorCommands' },
			{ kind: 'todo', label: 'snap', todo: 'editorCommands', checked: true },
			separator(),
			{ kind: 'action', label: 'show organizer', action: 'show-organizer' }
		]
	},
	{
		id: 'window',
		label: 'window',
		items: [
			{ kind: 'todo', label: 'adjustments', todo: 'editorCommands', checked: true },
			{ kind: 'todo', label: 'histogram', todo: 'editorCommands', checked: true },
			{ kind: 'todo', label: 'history', todo: 'editorCommands', checked: true },
			{ kind: 'todo', label: 'layers', todo: 'editorCommands', checked: true },
			{ kind: 'todo', label: 'masks', todo: 'editorCommands', checked: true },
			{ kind: 'todo', label: 'toolbar', todo: 'editorCommands', checked: true },
			separator(),
			{ kind: 'todo', label: 'reset workspace', todo: 'editorCommands' }
		]
	},
	{
		id: 'help',
		label: 'help',
		items: [
			{ kind: 'todo', label: 'keyboard shortcuts', todo: 'editorCommands' },
			{ kind: 'todo', label: 'implementation status', todo: 'editorCommands' },
			separator(),
			{ kind: 'action', label: 'postframe on GitHub', action: 'open-github' }
		]
	}
];
