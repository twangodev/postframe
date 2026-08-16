import type { ColorControlName, LightControlName } from './develop-settings';
import { cloneEditDocument, cloneEditMask, type EditMask } from './edit-document';
import type { EditorCommand } from './editor-command';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskEdgeControlName } from './mask-edge-settings';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import type { Photo } from './photo-record';

export interface AdjustmentControlsHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly selectedMaskId: string | null;
	readonly adjustments: Record<LightControlName | ColorControlName, number>;
	masks: EditMask[];
	dispatchEditorCommand(command: EditorCommand): boolean;
}

export class AdjustmentControls {
	constructor(
		private readonly develop: DevelopPreviewController,
		private readonly pipeline: MaskRasterPipeline,
		private readonly host: AdjustmentControlsHost
	) {}

	previewLight(control: LightControlName, value: number) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		this.host.adjustments[control] = value;
		const { light, color } = this.host.selectedPhoto.edit.adjustments;
		this.develop.schedule({ ...light, [control]: value }, color);
	}

	commitLight(control: LightControlName, value: number) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		if (!this.host.dispatchEditorCommand({ type: 'light.set', control, value })) {
			this.develop.release();
		}
	}

	previewColor(control: ColorControlName, value: number) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		this.host.adjustments[control] = value;
		const { light, color } = this.host.selectedPhoto.edit.adjustments;
		this.develop.schedule(light, { ...color, [control]: value });
	}

	commitColor(control: ColorControlName, value: number) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		if (!this.host.dispatchEditorCommand({ type: 'color.set', control, value })) {
			this.develop.release();
		}
	}

	previewMaskLight(control: LightControlName, value: number) {
		const document = this.previewedMaskDocument((mask) => {
			mask.adjustments.light = { ...mask.adjustments.light, [control]: value };
		});
		if (document) this.pipeline.scheduleMaskRender(document);
	}

	commitMaskLight(control: LightControlName, value: number) {
		this.commitMaskCommand((maskId) => ({ type: 'mask.light.set', maskId, control, value }));
	}

	previewMaskColor(control: ColorControlName, value: number) {
		const document = this.previewedMaskDocument((mask) => {
			mask.adjustments.color = { ...mask.adjustments.color, [control]: value };
		});
		if (document) this.pipeline.scheduleMaskRender(document);
	}

	commitMaskColor(control: ColorControlName, value: number) {
		this.commitMaskCommand((maskId) => ({ type: 'mask.color.set', maskId, control, value }));
	}

	previewMaskEdge(control: MaskEdgeControlName, value: number) {
		const document = this.previewedMaskDocument((mask) => {
			mask.edge = { ...mask.edge, [control]: value };
		});
		if (document) this.pipeline.scheduleMaskRender(document, true);
	}

	commitMaskEdge(control: MaskEdgeControlName, value: number) {
		this.commitMaskCommand((maskId) => ({ type: 'mask.edge.set', maskId, control, value }));
	}

	private previewedMaskDocument(mutate: (mask: EditMask) => void) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto || !this.host.selectedMaskId) {
			return null;
		}
		const document = cloneEditDocument(this.host.selectedPhoto.edit);
		const mask = document.masks.find(({ id }) => id === this.host.selectedMaskId);
		if (!mask) return null;
		mutate(mask);
		this.host.masks = document.masks.map(cloneEditMask);
		return document;
	}

	private commitMaskCommand(command: (maskId: string) => EditorCommand) {
		if (!this.host.canAdjustLight || !this.host.selectedMaskId) return;
		this.pipeline.clearMaskRenderTimer();
		if (!this.host.dispatchEditorCommand(command(this.host.selectedMaskId))) {
			this.pipeline.resetPreview();
		}
	}
}
