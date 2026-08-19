import type { NormalizedRegion } from './edit-document.ts';
import { toolLabel } from './editor-tools.ts';
import type { MaskPreviewMode } from './mask-preview.ts';
import type { MaskKind, WorkspaceState } from './workspace.svelte.ts';

export interface EditorToolSessionHost {
	workspace: WorkspaceState;
	onToolChange?: () => void;
}

export class EditorToolSession {
	private readonly host: EditorToolSessionHost;

	tool = $state('move');
	inspectorTab = $state('adjust');
	maskPreviewMode = $state<MaskPreviewMode | null>('overlay');
	maskBrushOperation = $state<'add' | 'subtract'>('add');
	refineBrushSize = $state(42);
	hoveredSubjectBox = $state<NormalizedRegion | null>(null);

	label = $derived(toolLabel(this.tool));
	selectedMask = $derived.by(() => this.host.workspace.selectedMask);
	subjectChoices = $derived.by(() =>
		this.host.workspace.subjectChoices?.photoId === this.host.workspace.editingPhoto?.id
			? this.host.workspace.subjectChoices
			: null
	);
	canRefineSelectedMask = $derived(
		this.selectedMask?.components.filter(
			(component) =>
				(component.type === 'ai-object' || component.type === 'ai-subject') &&
				component.raster !== null
		).length === 1
	);
	smartMaskWorking = $derived.by(() =>
		['downloading', 'loading', 'encoding', 'refining'].includes(
			this.host.workspace.smartMaskStatus.phase
		)
	);

	constructor(host: EditorToolSessionHost) {
		this.host = host;
	}

	choose = (tool: string) => {
		// TODO(WASM_TODOS.editorTools): start the selected tool in the Wasm document.
		if (tool === 'object-select' && this.tool !== 'object-select') {
			this.host.workspace.selectMask(null);
		}
		this.tool = tool;
		this.host.onToolChange?.();
		if (tool.startsWith('mask')) this.inspectorTab = 'mask';
	};

	addMask = (kind: MaskKind) => {
		this.host.workspace.createMask(kind);
		if (kind === 'linear') this.choose('mask-linear');
		else if (kind === 'radial') this.choose('mask-radial');
		else this.beginMaskBrush('add');
		this.maskPreviewMode = 'overlay';
	};

	beginMaskBrush = (operation: 'add' | 'subtract') => {
		this.maskBrushOperation = operation;
		this.choose('mask');
		this.maskPreviewMode = 'overlay';
	};

	beginObjectMask = () => {
		this.host.workspace.selectMask(null);
		this.choose('object-select');
		this.inspectorTab = 'mask';
		this.maskPreviewMode = 'overlay';
	};

	beginEdgeRefinement = () => {
		if (!this.canRefineSelectedMask) return;
		this.choose('mask-refine');
		this.maskPreviewMode = 'overlay';
	};
}
