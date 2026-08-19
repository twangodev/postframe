export interface StorageObserverTiming {
	quietMs: number;
	set: (fire: () => void, delay: number) => number;
	clear: (id: number) => void;
}

const DEFAULT_TIMING: StorageObserverTiming = {
	quietMs: 600,
	set: (fire, delay) => setTimeout(fire, delay) as unknown as number,
	clear: (id) => clearTimeout(id)
};

/**
 * Turns "something was written" into one refresh after the writes go quiet.
 * Measuring usage walks every stored file, so a slider drag that commits
 * twenty times must not scan twenty times, and a write that lands while a
 * measurement is in flight must still be measured.
 */
export class StorageObserver {
	private readonly refresh: () => Promise<void>;
	private readonly timing: StorageObserverTiming;
	private timer: number | null = null;
	private refreshing = false;
	private dirty = false;

	constructor(refresh: () => Promise<void>, timing: StorageObserverTiming = DEFAULT_TIMING) {
		this.refresh = refresh;
		this.timing = timing;
	}

	wrote() {
		if (this.timer !== null) this.timing.clear(this.timer);
		this.timer = this.timing.set(() => {
			this.timer = null;
			void this.settle();
		}, this.timing.quietMs);
	}

	stop() {
		if (this.timer !== null) this.timing.clear(this.timer);
		this.timer = null;
		this.dirty = false;
	}

	private async settle() {
		if (this.refreshing) {
			this.dirty = true;
			return;
		}
		this.refreshing = true;
		try {
			await this.refresh();
		} catch {
			// A failed probe waits for the next write.
		} finally {
			this.refreshing = false;
		}
		if (this.dirty) {
			this.dirty = false;
			void this.settle();
		}
	}
}
