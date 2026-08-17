import {
	withAdjustment,
	withCurve,
	type AdjustmentRecord,
	type ColorControlName,
	type CurveChannelName,
	type CurvePoints,
	type CurveSettings,
	type LightControlName,
	type ScalarControlName,
	type ScalarGroupName
} from './develop-settings';
import { cloneEditDocument, cloneEditMask, type EditMask } from './edit-document';
import { adjustmentCommand, curveCommand, type EditorCommand } from './editor-command';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskEdgeControlName } from './mask-edge-settings';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import type { Photo } from './photo-record';

export interface AdjustmentControlsHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly selectedMaskId: string | null;
	readonly adjustments: AdjustmentRecord;
	readonly curve: CurveSettings;
	masks: EditMask[];
	dispatchEditorCommand(command: EditorCommand): boolean;
}

export class AdjustmentControls {
	constructor(
		private readonly develop: DevelopPreviewController,
		private readonly pipeline: MaskRasterPipeline,
		private readonly host: AdjustmentControlsHost
	) {}

	previewAdjustment<Group extends ScalarGroupName>(
		group: Group,
		control: ScalarControlName<Group>,
		value: number
	) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		Object.assign(this.host.adjustments, { [control]: value });
		const edit = this.host.selectedPhoto.edit;
		this.develop.schedule(
			withAdjustment(edit.adjustments, group, control, value),
			edit.geometry.crop
		);
	}

	commitAdjustment<Group extends ScalarGroupName>(
		group: Group,
		control: ScalarControlName<Group>,
		value: number
	) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		if (!this.host.dispatchEditorCommand(adjustmentCommand(group, control, value))) {
			this.releaseUnchangedPreview();
		}
	}

	previewCurve(channel: CurveChannelName, points: CurvePoints) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		const edit = this.host.selectedPhoto.edit;
		const adjustments = withCurve(edit.adjustments, channel, points);
		this.host.curve[channel] = adjustments.curve[channel];
		this.develop.schedule(adjustments, edit.geometry.crop);
	}

	commitCurve(channel: CurveChannelName, points: CurvePoints) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		if (!this.host.dispatchEditorCommand(curveCommand(channel, points))) {
			this.releaseUnchangedPreview();
		}
	}

	previewLight(control: LightControlName, value: number) {
		this.previewAdjustment('light', control, value);
	}

	commitLight(control: LightControlName, value: number) {
		this.commitAdjustment('light', control, value);
	}

	previewColor(control: ColorControlName, value: number) {
		this.previewAdjustment('color', control, value);
	}

	commitColor(control: ColorControlName, value: number) {
		this.commitAdjustment('color', control, value);
	}

	private releaseUnchangedPreview() {
		this.develop.release();
		const edit = this.host.selectedPhoto?.edit;
		if (edit) this.develop.refreshScope(edit.adjustments, edit.geometry.crop);
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
