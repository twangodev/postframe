import {
	cloneEditDocument,
	editDocumentSchema,
	editMaskSchema,
	normalizedCropSchema,
	type EditDocument,
	type EditMask,
	type NormalizedCrop
} from './edit-document.ts';
import { lightSettingsSchema, type LightControlName } from './develop-settings.ts';

export type EditorInvalidation = 'render' | 'geometry' | 'overlay';

export type EditorCommand =
	| { type: 'light.set'; control: LightControlName; value: number }
	| { type: 'mask.create'; mask: EditMask }
	| { type: 'mask.visibility'; maskId: string; visible: boolean }
	| { type: 'mask.delete'; maskId: string }
	| { type: 'geometry.rotate'; rotation: number }
	| { type: 'geometry.flip'; axis: 'horizontal' | 'vertical' }
	| { type: 'geometry.crop'; crop: NormalizedCrop | null };

export interface EditorTransition {
	command: EditorCommand;
	label: string;
	invalidation: EditorInvalidation;
	document: EditDocument;
}

export function applyEditorCommand(
	document: EditDocument,
	command: EditorCommand
): EditorTransition | null {
	const next = cloneEditDocument(document);

	switch (command.type) {
		case 'light.set': {
			const light = lightSettingsSchema.parse({
				...next.adjustments.light,
				[command.control]: command.value
			});
			if (next.adjustments.light[command.control] === light[command.control]) return null;
			next.adjustments.light = light;
			return transition(command, lightLabel(command.control, command.value), 'render', next);
		}
		case 'mask.create': {
			const mask = editMaskSchema.parse(command.mask);
			if (next.masks.some(({ id }) => id === mask.id)) throw new Error(`Mask ${mask.id} exists`);
			next.masks.push(mask);
			return transition(command, `created ${mask.name} mask`, 'overlay', next);
		}
		case 'mask.visibility': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask || mask.visible === command.visible) return null;
			mask.visible = command.visible;
			return transition(
				command,
				`${command.visible ? 'showed' : 'hid'} ${mask.name} mask`,
				'overlay',
				next
			);
		}
		case 'mask.delete': {
			const mask = next.masks.find(({ id }) => id === command.maskId);
			if (!mask) return null;
			next.masks = next.masks.filter(({ id }) => id !== command.maskId);
			return transition(command, `deleted ${mask.name} mask`, 'overlay', next);
		}
		case 'geometry.rotate': {
			if (next.geometry.rotation === command.rotation) return null;
			next.geometry.rotation = command.rotation;
			return transition(command, `rotated ${formatNumber(command.rotation)}°`, 'geometry', next);
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

function transition(
	command: EditorCommand,
	label: string,
	invalidation: EditorInvalidation,
	document: EditDocument
): EditorTransition {
	return { command, label, invalidation, document: editDocumentSchema.parse(document) };
}

function lightLabel(control: LightControlName, value: number) {
	const suffix = control === 'exposure' ? ' EV' : '';
	return `${control} ${value > 0 ? '+' : ''}${formatNumber(value)}${suffix}`;
}

function formatNumber(value: number) {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
