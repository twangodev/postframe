import type { MaskAdjustmentChange } from './adjustment-controls.ts';
import {
	defaultMaskAdjustments,
	type CurveChannelName,
	type CurvePoints,
	type CurveSettings,
	type GradingSettings,
	type MaskAdjustmentTarget,
	type MixerSettings
} from './develop-settings.ts';
import type { EditMask } from './edit-document.ts';

/// What the curve, mixer and grading sections edit: the document's own settings or the selected mask's, behind one shape.
export interface DevelopBinding {
	readonly disabled: boolean;
	readonly curve: CurveSettings;
	readonly mixer: MixerSettings;
	readonly grading: GradingSettings;
	previewCurve(channel: CurveChannelName, points: CurvePoints): void;
	commitCurve(channel: CurveChannelName, points: CurvePoints): void;
	previewAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	commitAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	previewAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
	commitAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
}

export interface GlobalDevelopHost {
	readonly canAdjustLight: boolean;
	readonly curve: CurveSettings;
	readonly mixer: MixerSettings;
	readonly grading: GradingSettings;
	previewCurve(channel: CurveChannelName, points: CurvePoints): void;
	commitCurve(channel: CurveChannelName, points: CurvePoints): void;
	previewAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	commitAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	previewAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
	commitAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
}

export interface MaskDevelopHost {
	readonly canAdjustLight: boolean;
	readonly selectedMask: EditMask | null;
	previewMaskCurve(channel: CurveChannelName, points: CurvePoints): void;
	commitMaskCurve(channel: CurveChannelName, points: CurvePoints): void;
	previewMaskAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	commitMaskAdjustmentAt(target: MaskAdjustmentTarget, value: number): void;
	previewMaskAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
	commitMaskAdjustmentsAt(changes: readonly MaskAdjustmentChange[]): void;
}

export function globalDevelopBinding(host: GlobalDevelopHost): DevelopBinding {
	return {
		get disabled() {
			return !host.canAdjustLight;
		},
		get curve() {
			return host.curve;
		},
		get mixer() {
			return host.mixer;
		},
		get grading() {
			return host.grading;
		},
		previewCurve: (channel, points) => host.previewCurve(channel, points),
		commitCurve: (channel, points) => host.commitCurve(channel, points),
		previewAdjustmentAt: (target, value) => host.previewAdjustmentAt(target, value),
		commitAdjustmentAt: (target, value) => host.commitAdjustmentAt(target, value),
		previewAdjustmentsAt: (changes) => host.previewAdjustmentsAt(changes),
		commitAdjustmentsAt: (changes) => host.commitAdjustmentsAt(changes)
	};
}

export function maskDevelopBinding(host: MaskDevelopHost): DevelopBinding {
	const adjustments = () => host.selectedMask?.adjustments ?? defaultMaskAdjustments();
	return {
		get disabled() {
			return !host.canAdjustLight || (host.selectedMask?.components.length ?? 0) === 0;
		},
		get curve() {
			return adjustments().curve;
		},
		get mixer() {
			return adjustments().mixer;
		},
		get grading() {
			return adjustments().grading;
		},
		previewCurve: (channel, points) => host.previewMaskCurve(channel, points),
		commitCurve: (channel, points) => host.commitMaskCurve(channel, points),
		previewAdjustmentAt: (target, value) => host.previewMaskAdjustmentAt(target, value),
		commitAdjustmentAt: (target, value) => host.commitMaskAdjustmentAt(target, value),
		previewAdjustmentsAt: (changes) => host.previewMaskAdjustmentsAt(changes),
		commitAdjustmentsAt: (changes) => host.commitMaskAdjustmentsAt(changes)
	};
}
