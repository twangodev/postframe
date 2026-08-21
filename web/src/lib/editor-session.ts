import {
	cloneDevelopSettings,
	defaultDevelopSettings,
	mirrorAdjustments,
	sameDevelopSettings,
	type AdjustmentMirror,
	type DevelopSettings
} from './develop-settings';
import {
	cloneCrop,
	cloneEditDocument,
	cloneEditMask,
	type EditDocument,
	type EditMask,
	type NormalizedCrop
} from './edit-document';
import { applyEditorCommand, type EditorCommand, type EditorInvalidation } from './editor-command';
import { EditorHistory } from './editor-history';
import type { ImageScopeData } from './image-scope';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskRasterPipeline, SelectedMaskRaster } from './mask-raster-pipeline';
import type { Photo } from './photo-record';
import type { SmartMaskStatus } from './smart-masking';
import type { WorkspacePersistence } from './workspace-persistence';

export interface EditorSessionHost extends AdjustmentMirror {
	readonly selectedPhoto: Photo | null;
	masks: EditMask[];
	selectedMaskId: string | null;
	selectedMaskRaster: SelectedMaskRaster | null;
	imageScope: ImageScopeData | null;
	smartMaskStatus: SmartMaskStatus;
	renderSettings: { adjustments: DevelopSettings; crop: NormalizedCrop | null; revision: number };
	history: string[];
	canUndo: boolean;
	canRedo: boolean;
	pushCameraLook(amount: number): void;
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
		const historyBefore =
			command.type === 'profile.cameraMatch' && before.profile.cameraMatch.status === 'pending'
				? cloneEditDocument({
						...before,
						profile: {
							cameraLook: 0,
							cameraLookEnabled: false,
							cameraMatch: { status: 'dismissed' }
						}
					})
				: before;
		this.editorHistory.commit(historyBefore, transition);
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
		const adjustments = document?.adjustments ?? defaultDevelopSettings();
		if (document) this.host.pushCameraLook(effectiveCameraLook(document));
		this.host.masks = document?.masks.map(cloneEditMask) ?? [];
		this.host.selectedMaskId = null;
		this.host.selectedMaskRaster = null;
		this.host.smartMaskStatus = { phase: 'idle', progress: null, detail: '', error: null };
		mirrorAdjustments(this.host, adjustments);
		this.host.renderSettings = {
			adjustments: cloneDevelopSettings(adjustments),
			crop: cloneCrop(document?.geometry.crop ?? null),
			revision: this.host.renderSettings.revision + 1
		};
		this.syncHistory();
	}

	private apply(document: EditDocument, invalidation: EditorInvalidation) {
		if (!this.host.selectedPhoto || document.photoId !== this.host.selectedPhoto.id) return;
		const next = cloneEditDocument(document);
		const globalAdjustmentsChanged = !sameDevelopSettings(
			this.host.selectedPhoto.edit.adjustments,
			next.adjustments
		);
		const cameraLookChanged =
			effectiveCameraLook(this.host.selectedPhoto.edit) !== effectiveCameraLook(next);
		this.host.selectedPhoto.edit = next;
		this.host.masks = next.masks.map(cloneEditMask);
		if (
			this.host.selectedMaskId &&
			!this.host.masks.some(({ id }) => id === this.host.selectedMaskId)
		) {
			this.host.selectedMaskId = this.host.masks.at(-1)?.id ?? null;
		}
		mirrorAdjustments(this.host, next.adjustments);

		if (invalidation === 'render') {
			if (cameraLookChanged) this.host.pushCameraLook(effectiveCameraLook(next));
			if (globalAdjustmentsChanged || cameraLookChanged) {
				this.develop.request(next.adjustments, next.geometry.crop, 'refining');
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

function effectiveCameraLook(document: EditDocument) {
	return document.profile.cameraLookEnabled ? document.profile.cameraLook : 0;
}
