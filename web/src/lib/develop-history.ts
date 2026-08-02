import type { DevelopSettings } from './develop-settings.ts';

export interface DevelopHistoryEntry {
	label: string;
	before: DevelopSettings;
	after: DevelopSettings;
}

export class DevelopHistory {
	private past: DevelopHistoryEntry[] = [];
	private future: DevelopHistoryEntry[] = [];

	get canUndo() {
		return this.past.length > 0;
	}

	get canRedo() {
		return this.future.length > 0;
	}

	get labels() {
		return this.past.map(({ label }) => label);
	}

	commit(entry: DevelopHistoryEntry) {
		if (sameSettings(entry.before, entry.after)) return false;
		this.past.push(cloneEntry(entry));
		this.future = [];
		return true;
	}

	undo() {
		const entry = this.past.pop();
		if (!entry) return null;
		this.future.push(entry);
		return { ...entry.before };
	}

	redo() {
		const entry = this.future.pop();
		if (!entry) return null;
		this.past.push(entry);
		return { ...entry.after };
	}

	reset() {
		this.past = [];
		this.future = [];
	}
}

function sameSettings(left: DevelopSettings, right: DevelopSettings) {
	return left.version === right.version && left.exposure === right.exposure;
}

function cloneEntry(entry: DevelopHistoryEntry): DevelopHistoryEntry {
	return { label: entry.label, before: { ...entry.before }, after: { ...entry.after } };
}
