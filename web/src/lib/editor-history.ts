import { cloneEditDocument, type EditDocument } from './edit-document.ts';
import type { EditorCommand, EditorInvalidation, EditorTransition } from './editor-command.ts';

export interface EditorHistoryEntry {
	command: EditorCommand;
	label: string;
	invalidation: EditorInvalidation;
	before: EditDocument;
	after: EditDocument;
}

export interface EditorHistoryResult {
	document: EditDocument;
	invalidation: EditorInvalidation;
}

export class EditorHistory {
	private past: EditorHistoryEntry[] = [];
	private future: EditorHistoryEntry[] = [];

	get canUndo() {
		return this.past.length > 0;
	}

	get canRedo() {
		return this.future.length > 0;
	}

	get labels() {
		return this.past.map(({ label }) => label);
	}

	commit(before: EditDocument, transition: EditorTransition) {
		this.past.push({
			command: structuredClone(transition.command),
			label: transition.label,
			invalidation: transition.invalidation,
			before: cloneEditDocument(before),
			after: cloneEditDocument(transition.document)
		});
		this.future = [];
	}

	undo(): EditorHistoryResult | null {
		const entry = this.past.pop();
		if (!entry) return null;
		this.future.push(entry);
		return { document: cloneEditDocument(entry.before), invalidation: entry.invalidation };
	}

	redo(): EditorHistoryResult | null {
		const entry = this.future.pop();
		if (!entry) return null;
		this.past.push(entry);
		return { document: cloneEditDocument(entry.after), invalidation: entry.invalidation };
	}

	reset() {
		this.past = [];
		this.future = [];
	}
}
