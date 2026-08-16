import {
	COLOR_CONTROL_NAMES,
	defaultColorSettings,
	defaultLightSettings,
	LIGHT_CONTROL_NAMES,
	type ColorControlName,
	type ColorSettings,
	type LightControlName,
	type LightSettings
} from './develop-settings';
import {
	cloneEditDocument,
	cloneEditMask,
	type EditDocument,
	type EditMask
} from './edit-document';
import { applyEditorCommand, type EditorCommand, type EditorInvalidation } from './editor-command';
import { EditorHistory } from './editor-history';
import type { ImageScopeData } from './image-scope';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskRasterPipeline, SelectedMaskRaster } from './mask-raster-pipeline';
import type { Photo } from './photo-record';
import type { SmartMaskStatus } from './smart-masking';
import type { WorkspacePersistence } from './workspace-persistence';

export const defaultAdjustments = {
	temperature: 0,
	tint: 0,
	exposure: 0,
	contrast: 0,
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0,
	vibrance: 0,
	saturation: 0,
	texture: 0,
	clarity: 0,
	dehaze: 0,
	sharpening: 40,
	noiseReduction: 10
};

export interface EditorSessionHost {
	readonly selectedPhoto: Photo | null;
	masks: EditMask[];
	selectedMaskId: string | null;
	selectedMaskRaster: SelectedMaskRaster | null;
	imageScope: ImageScopeData | null;
	smartMaskStatus: SmartMaskStatus;
	adjustments: Record<LightControlName | ColorControlName, number>;
	renderSettings: { settings: LightSettings; color: ColorSettings; revision: number };
	history: string[];
	canUndo: boolean;
	canRedo: boolean;
}

export class EditorSession {
	private readonly editorHistory = new EditorHistory();

	constructor(
		private readonly develop: DevelopPreviewController,
		private readonly pipeline: MaskRasterPipeline,
		private readonly persistence: WorkspacePersistence,
		private readonly host: EditorSessionHost
	) {}

	dispatch(command: EditorCommand) {
		if (!this.host.selectedPhoto) return false;
		const before = cloneEditDocument(this.host.selectedPhoto.edit);
		const transition = applyEditorCommand(before, command);
		if (!transition) return false;
		this.editorHistory.commit(before, transition);
		this.apply(transition.document, transition.invalidation);
		this.syncHistory();
		return true;
	}

	undo() {
		const result = this.editorHistory.undo();
		if (!result) return;
		this.apply(result.document, result.invalidation);
		this.syncHistory();
	}

	redo() {
		const result = this.editorHistory.redo();
		if (!result) return;
		this.apply(result.document, result.invalidation);
		this.syncHistory();
	}

	resetHistory() {
		this.editorHistory.reset();
		this.syncHistory();
	}

	resetEditState(document: EditDocument | null = null) {
		this.develop.release();
		this.pipeline.invalidate();
		this.host.imageScope = null;
		this.editorHistory.reset();
		const light = document?.adjustments.light ?? defaultLightSettings();
		const color = document?.adjustments.color ?? defaultColorSettings();
		this.host.masks = document?.masks.map(cloneEditMask) ?? [];
		this.host.selectedMaskId = null;
		this.host.selectedMaskRaster = null;
		this.host.smartMaskStatus = { phase: 'idle', progress: null, detail: '', error: null };
		this.host.adjustments = { ...defaultAdjustments, ...light, ...color };
		this.host.renderSettings = {
			settings: { ...light },
			color: { ...color },
			revision: this.host.renderSettings.revision + 1
		};
		this.syncHistory();
	}

	private apply(document: EditDocument, invalidation: EditorInvalidation) {
		if (!this.host.selectedPhoto || document.photoId !== this.host.selectedPhoto.id) return;
		const next = cloneEditDocument(document);
		const current = this.host.selectedPhoto.edit.adjustments;
		const globalAdjustmentsChanged =
			LIGHT_CONTROL_NAMES.some(
				(control) => current.light[control] !== next.adjustments.light[control]
			) ||
			COLOR_CONTROL_NAMES.some(
				(control) => current.color[control] !== next.adjustments.color[control]
			);
		this.host.selectedPhoto.edit = next;
		this.host.masks = next.masks.map(cloneEditMask);
		if (
			this.host.selectedMaskId &&
			!this.host.masks.some(({ id }) => id === this.host.selectedMaskId)
		) {
			this.host.selectedMaskId = this.host.masks.at(-1)?.id ?? null;
		}
		for (const control of LIGHT_CONTROL_NAMES) {
			this.host.adjustments[control] = next.adjustments.light[control];
		}
		for (const control of COLOR_CONTROL_NAMES) {
			this.host.adjustments[control] = next.adjustments.color[control];
		}

		if (invalidation === 'render') {
			if (globalAdjustmentsChanged) {
				this.develop.request(next.adjustments.light, next.adjustments.color, 'refining');
			}
			this.pipeline.renderEditDocument(next);
		}
		void this.pipeline.refreshSelectedMaskRaster();
		// TODO(WASM_TODOS.documentGeometry): invalidate transformed bounds and render tiles.
		void this.persistence.queue((store) => store.saveEditDocument(next.photoId, next));
	}

	private syncHistory() {
		this.host.history = ['imported', ...this.editorHistory.labels];
		this.host.canUndo = this.editorHistory.canUndo;
		this.host.canRedo = this.editorHistory.canRedo;
	}
}
