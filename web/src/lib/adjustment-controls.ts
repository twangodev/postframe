import {
	mirrorAdjustments,
	withAdjustmentAt,
	withCurve,
	withMaskAdjustmentAt,
	withMaskCurve,
	type AdjustmentMirror,
	type AdjustmentTarget,
	type CurveChannelName,
	type CurvePoints,
	type DevelopSettings,
	type MaskAdjustmentTarget,
	type ScalarControlName,
	type ScalarGroupName
} from './develop-settings';
import { cloneEditDocument, cloneEditMask, type EditMask } from './edit-document';
import { adjustmentCommand, curveCommand, type EditorCommand } from './editor-command';
import type { DevelopPreviewController } from './develop-preview';
import type { MaskEdgeControlName } from './mask-edge-settings';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import type { Photo } from './photo-record';

export interface AdjustmentChange {
	target: AdjustmentTarget;
	value: number;
}

export interface MaskAdjustmentChange {
	target: MaskAdjustmentTarget;
	value: number;
}

export interface AdjustmentControlsHost extends AdjustmentMirror {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly selectedMaskId: string | null;
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
		this.previewAdjustmentAt({ group, control } as AdjustmentTarget, value);
	}

	commitAdjustment<Group extends ScalarGroupName>(
		group: Group,
		control: ScalarControlName<Group>,
		value: number
	) {
		this.commitAdjustmentAt({ group, control } as AdjustmentTarget, value);
	}

	previewAdjustmentAt(target: AdjustmentTarget, value: number) {
		this.previewAdjustmentsAt([{ target, value }]);
	}

	commitAdjustmentAt(target: AdjustmentTarget, value: number) {
		this.commitAdjustmentsAt([{ target, value }]);
	}

	/// A grading puck moves a hue and a saturation with one gesture, so previews
	/// and commits take a whole set of changes rather than a single control.
	previewAdjustmentsAt(changes: readonly AdjustmentChange[]) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		const edit = this.host.selectedPhoto.edit;
		const adjustments = changes.reduce(
			(settings, { target, value }) => withAdjustmentAt(settings, target, value),
			edit.adjustments
		);
		mirrorAdjustments(this.host, adjustments);
		this.develop.schedule(adjustments, edit.geometry.crop);
	}

	commitAdjustmentsAt(changes: readonly AdjustmentChange[]) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return;
		const applied = changes
			.map(({ target, value }) => this.host.dispatchEditorCommand(adjustmentCommand(target, value)))
			.some(Boolean);
		if (!applied) this.releaseUnchangedPreview();
	}

	commitAdjustments(adjustments: DevelopSettings, label: string) {
		if (!this.host.canAdjustLight || !this.host.selectedPhoto) return false;
		return this.host.dispatchEditorCommand({ type: 'adjustment.replace', adjustments, label });
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

	private releaseUnchangedPreview() {
		this.develop.release();
		const edit = this.host.selectedPhoto?.edit;
		if (edit) this.develop.refreshScope(edit.adjustments, edit.geometry.crop);
	}

	previewMaskAdjustmentAt(target: MaskAdjustmentTarget, value: number) {
		this.previewMaskAdjustmentsAt([{ target, value }]);
	}

	commitMaskAdjustmentAt(target: MaskAdjustmentTarget, value: number) {
		this.commitMaskAdjustmentsAt([{ target, value }]);
	}

	previewMaskAdjustmentsAt(changes: readonly MaskAdjustmentChange[]) {
		const document = this.previewedMaskDocument((mask) => {
			mask.adjustments = changes.reduce(
				(adjustments, { target, value }) => withMaskAdjustmentAt(adjustments, target, value),
				mask.adjustments
			);
		});
		if (document) this.pipeline.scheduleMaskRender(document);
	}

	commitMaskAdjustmentsAt(changes: readonly MaskAdjustmentChange[]) {
		this.commitMaskCommands((maskId) =>
			changes.map(({ target, value }) => ({ type: 'mask.adjustment.set', maskId, target, value }))
		);
	}

	previewMaskCurve(channel: CurveChannelName, points: CurvePoints) {
		const document = this.previewedMaskDocument((mask) => {
			mask.adjustments = withMaskCurve(mask.adjustments, channel, points);
		});
		if (document) this.pipeline.scheduleMaskRender(document);
	}

	commitMaskCurve(channel: CurveChannelName, points: CurvePoints) {
		this.commitMaskCommand((maskId) => ({
			type: 'mask.curve.set',
			maskId,
			channel,
			value: points
		}));
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
		this.commitMaskCommands((maskId) => [command(maskId)]);
	}

	private commitMaskCommands(commands: (maskId: string) => readonly EditorCommand[]) {
		if (!this.host.canAdjustLight || !this.host.selectedMaskId) return;
		this.pipeline.clearMaskRenderTimer();
		const applied = commands(this.host.selectedMaskId)
			.map((command) => this.host.dispatchEditorCommand(command))
			.some(Boolean);
		if (!applied) this.pipeline.resetPreview();
	}
}
