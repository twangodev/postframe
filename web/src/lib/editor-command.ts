import { formatAdjustment } from './adjustment-format.ts';
import { adjustmentSuffix } from './develop-sliders.ts';
import {
	cloneEditDocument,
	editDocumentSchema,
	editMaskSchema,
	editProfileSchema,
	editSnapshotSchema,
	maskComponentSchema,
	normalizedCropSchema,
	type EditDocument,
	type EditMask,
	type EditSnapshot,
	type MaskComponent,
	type NormalizedCrop
} from './edit-document.ts';
import {
	cloneDevelopSettings,
	curvePointsSchema,
	developSettingsSchema,
	sameDevelopSettings,
	sameMaskAdjustments,
	withAdjustmentAt,
	withCurve,
	withMaskAdjustmentAt,
	withMaskCurve,
	type AdjustmentTarget,
	type CurveChannelName,
	type CurvePoints,
	type DevelopSettings,
	type MaskAdjustments,
	type MaskAdjustmentTarget
} from './develop-settings.ts';
import { maskEdgeSettingsSchema, type MaskEdgeControlName } from './mask-edge-settings.ts';
import {
	cameraMatchResultSchema,
	type CameraMatchResult,
	type CameraMatchTarget
} from './camera-match.ts';

export type EditorInvalidation = 'render' | 'geometry' | 'overlay';

export type AdjustmentCommand =
	| (AdjustmentTarget & { type: 'adjustment.set'; value: number })
	| {
			type: 'adjustment.set';
			group: 'curve';
			control: CurveChannelName;
			value: CurvePoints;
	  };

export function adjustmentCommand(target: AdjustmentTarget, value: number): AdjustmentCommand {
	return { type: 'adjustment.set', ...target, value } as AdjustmentCommand;
}

export function curveCommand(channel: CurveChannelName, points: CurvePoints): AdjustmentCommand {
	return { type: 'adjustment.set', group: 'curve', control: channel, value: points };
}

export type EditorCommand =
	| AdjustmentCommand
	| { type: 'adjustment.replace'; adjustments: DevelopSettings; label: string }
	| { type: 'mask.adjustment.set'; maskId: string; target: MaskAdjustmentTarget; value: number }
	| { type: 'mask.curve.set'; maskId: string; channel: CurveChannelName; value: CurvePoints }
	| { type: 'mask.edge.set'; maskId: string; control: MaskEdgeControlName; value: number }
	| { type: 'mask.create'; mask: EditMask }
	| { type: 'mask.component.set'; maskId: string; component: MaskComponent }
	| { type: 'mask.visibility'; maskId: string; visible: boolean }
	| { type: 'mask.delete'; maskId: string }
	| { type: 'profile.cameraLook'; amount: number }
	| { type: 'profile.cameraLookEnabled'; enabled: boolean }
	| {
			type: 'profile.cameraMatch';
			adjustments: DevelopSettings;
			result: CameraMatchResult;
			target: CameraMatchTarget;
			label?: string;
	  }
	| { type: 'profile.cameraMatch.dismiss'; adjustments: DevelopSettings }
	| { type: 'snapshot.create'; snapshot: EditSnapshot }
	| { type: 'snapshot.apply'; snapshotId: string }
	| { type: 'snapshot.delete'; snapshotId: string }
	| { type: 'geometry.rotate'; rotation: number }
	| { type: 'geometry.flip'; axis: 'horizontal' | 'vertical' }
	| { type: 'geometry.crop'; crop: NormalizedCrop | null };

export interface EditorTransition {
	command: EditorCommand;
	label: string;
	invalidation: EditorInvalidation;
	document: EditDocument;
}

export function cloneEditorCommand(command: EditorCommand): EditorCommand {
	switch (command.type) {
		case 'adjustment.set':
			return command.group === 'curve'
				? { ...command, value: curvePointsSchema.parse(command.value) }
				: { ...command };
		case 'adjustment.replace':
			return { ...command, adjustments: developSettingsSchema.parse(command.adjustments) };
		case 'profile.cameraMatch':
			return {
				...command,
				adjustments: developSettingsSchema.parse(command.adjustments),
				result: cameraMatchResultSchema.parse(command.result)
			};
		case 'profile.cameraMatch.dismiss':
			return { ...command, adjustments: developSettingsSchema.parse(command.adjustments) };
		case 'mask.adjustment.set':
			return { ...command, target: { ...command.target } };
		case 'mask.curve.set':
			return { ...command, value: curvePointsSchema.parse(command.value) };
		case 'mask.create':
			return { ...command, mask: editMaskSchema.parse(command.mask) };
		case 'mask.component.set':
			return { ...command, component: maskComponentSchema.parse(command.component) };
		case 'geometry.crop':
			return {
				...command,
				crop: command.crop ? normalizedCropSchema.parse(command.crop) : null
			};
		default:
			return { ...command };
	}
}

export function applyEditorCommand(
	document: EditDocument,
	command: EditorCommand
): EditorTransition | null {
	const next = cloneEditDocument(document);

	switch (command.type) {
		case 'adjustment.set': {
			const curved = command.group === 'curve';
			const adjustments: DevelopSettings = developSettingsSchema.parse(
				curved
					? withCurve(next.adjustments, command.control, command.value)
					: withAdjustmentAt(next.adjustments, command, command.value)
			);
			if (sameDevelopSettings(next.adjustments, adjustments)) return null;
			next.adjustments = adjustments;
			const label = curved ? `${command.control} curve` : targetLabel(command, command.value);
			return transition(command, label, 'render', next);
		}
		case 'adjustment.replace': {
			const adjustments = developSettingsSchema.parse(command.adjustments);
			if (sameDevelopSettings(next.adjustments, adjustments)) return null;
			next.adjustments = adjustments;
			return transition(command, command.label, 'render', next);
		}
		case 'mask.adjustment.set':
			return maskAdjustmentTransition(
				next,
				command,
				(adjustments) => withMaskAdjustmentAt(adjustments, command.target, command.value),
				`mask ${targetLabel(command.target, command.value)}`
			);
		case 'mask.curve.set':
			return maskAdjustmentTransition(
				next,
				command,
				(adjustments) => withMaskCurve(adjustments, command.channel, command.value),
				`mask ${command.channel} curve`
			);
		case 'mask.edge.set': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask) return null;
			const edge = maskEdgeSettingsSchema.parse({
				...mask.edge,
				[command.control]: command.value
			});
			if (mask.edge[command.control] === edge[command.control]) return null;
			mask.edge = edge;
			return transition(command, edgeLabel(command.control, command.value), 'render', next);
		}
		case 'mask.create': {
			const mask = editMaskSchema.parse(command.mask);
			if (next.masks.some(({ id }) => id === mask.id)) throw new Error(`Mask ${mask.id} exists`);
			next.masks.push(mask);
			return transition(command, `created ${mask.name} mask`, 'render', next);
		}
		case 'mask.component.set': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask) return null;
			const component = maskComponentSchema.parse(command.component);
			const index = mask.components.findIndex(({ id }) => id === component.id);
			if (index === -1) mask.components.push(component);
			else if (JSON.stringify(mask.components[index]) === JSON.stringify(component)) return null;
			else mask.components[index] = component;
			return transition(command, `updated ${mask.name} mask`, 'render', next);
		}
		case 'mask.visibility': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask || mask.visible === command.visible) return null;
			mask.visible = command.visible;
			return transition(
				command,
				`${command.visible ? 'showed' : 'hid'} ${mask.name} mask`,
				'render',
				next
			);
		}
		case 'mask.delete': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask) return null;
			next.masks = next.masks.filter(({ id }) => id !== command.maskId);
			return transition(command, `deleted ${mask.name} mask`, 'render', next);
		}
		case 'profile.cameraLook': {
			const amount = editProfileSchema.parse({
				...next.profile,
				cameraLook: command.amount
			}).cameraLook;
			if (next.profile.cameraLook === amount) return null;
			next.profile = { ...next.profile, cameraLook: amount };
			return transition(
				command,
				`camera look ${formatAdjustment(amount, { signed: false })}`,
				'render',
				next
			);
		}
		case 'profile.cameraLookEnabled': {
			if (next.profile.cameraLookEnabled === command.enabled) return null;
			next.profile = { ...next.profile, cameraLookEnabled: command.enabled };
			return transition(
				command,
				`${command.enabled ? 'showed' : 'hid'} camera look`,
				'render',
				next
			);
		}
		case 'profile.cameraMatch': {
			const adjustments = developSettingsSchema.parse(command.adjustments);
			const result = cameraMatchResultSchema.parse(command.result);
			const profile = editProfileSchema.parse({
				cameraLook: result.cameraLook,
				cameraLookEnabled: true,
				cameraMatch: { status: 'applied', target: command.target, result }
			});
			if (
				sameDevelopSettings(next.adjustments, adjustments) &&
				JSON.stringify(next.profile) === JSON.stringify(profile)
			) {
				return null;
			}
			next.adjustments = adjustments;
			next.profile = profile;
			const target = command.target === 'camera-jpeg' ? 'camera JPEG' : 'embedded preview';
			return transition(command, command.label ?? `matched to ${target}`, 'render', next);
		}
		case 'profile.cameraMatch.dismiss': {
			const adjustments = developSettingsSchema.parse(command.adjustments);
			const profile = editProfileSchema.parse({
				cameraLook: 0,
				cameraLookEnabled: false,
				cameraMatch: { status: 'dismissed' }
			});
			if (
				sameDevelopSettings(next.adjustments, adjustments) &&
				JSON.stringify(next.profile) === JSON.stringify(profile)
			) {
				return null;
			}
			next.adjustments = adjustments;
			next.profile = profile;
			return transition(command, 'started from neutral RAW', 'render', next);
		}
		case 'snapshot.create': {
			const snapshot = editSnapshotSchema.parse(command.snapshot);
			if (next.snapshots.some(({ id }) => id === snapshot.id)) {
				throw new Error(`Snapshot ${snapshot.id} exists`);
			}
			next.snapshots = [...next.snapshots, snapshot];
			return transition(command, `saved ${snapshot.name} snapshot`, 'overlay', next);
		}
		case 'snapshot.apply': {
			const snapshot = next.snapshots.find(({ id }) => id === command.snapshotId);
			if (!snapshot || sameDevelopSettings(next.adjustments, snapshot.adjustments)) return null;
			next.adjustments = cloneDevelopSettings(snapshot.adjustments);
			return transition(command, `applied ${snapshot.name} snapshot`, 'render', next);
		}
		case 'snapshot.delete': {
			const snapshot = next.snapshots.find(({ id }) => id === command.snapshotId);
			if (!snapshot) return null;
			next.snapshots = next.snapshots.filter(({ id }) => id !== command.snapshotId);
			return transition(command, `deleted ${snapshot.name} snapshot`, 'overlay', next);
		}
		case 'geometry.rotate': {
			if (next.geometry.rotation === command.rotation) return null;
			next.geometry.rotation = command.rotation;
			return transition(
				command,
				`rotated ${formatAdjustment(command.rotation, { signed: false, suffix: '°' })}`,
				'geometry',
				next
			);
		}
		case 'geometry.flip': {
			const key = command.axis === 'horizontal' ? 'flipHorizontal' : 'flipVertical';
			next.geometry[key] = !next.geometry[key];
			return transition(command, `flipped ${command.axis}`, 'geometry', next);
		}
		case 'geometry.crop': {
			const crop = command.crop ? normalizedCropSchema.parse(command.crop) : null;
			if (JSON.stringify(next.geometry.crop) === JSON.stringify(crop)) return null;
			next.geometry.crop = crop;
			return transition(command, crop ? 'cropped' : 'reset crop', 'geometry', next);
		}
	}
}

function maskAdjustmentTransition(
	next: EditDocument,
	command: EditorCommand & { maskId: string },
	adjust: (adjustments: MaskAdjustments) => MaskAdjustments,
	label: string
) {
	const mask = next.masks.find(({ id }) => id === command.maskId);
	if (!mask) return null;
	const adjustments = adjust(mask.adjustments);
	if (sameMaskAdjustments(mask.adjustments, adjustments)) return null;
	mask.adjustments = adjustments;
	return transition(command, label, 'render', next);
}

function transition(
	command: EditorCommand,
	label: string,
	invalidation: EditorInvalidation,
	document: EditDocument
): EditorTransition {
	return { command, label, invalidation, document: editDocumentSchema.parse(document) };
}

function targetLabel(target: AdjustmentTarget, value: number) {
	const section = 'band' in target ? target.band : 'range' in target ? target.range : null;
	return controlLabel(section ? `${section} ${target.control}` : target.control, value);
}

function controlLabel(control: string, value: number) {
	return `${control} ${formatAdjustment(value, { signed: true, suffix: adjustmentSuffix(control) })}`;
}

function edgeLabel(control: MaskEdgeControlName, value: number) {
	return `mask ${controlLabel(control, value)}`;
}
