export interface TransferReadout {
	bytesPerSecond: number;
	secondsLeft: number | null;
}

interface TransferSample {
	at: number;
	loaded: number;
}

const WINDOW_MS = 3000;
const READOUT_INTERVAL_MS = 500;

export class TransferRate {
	private readonly samples: TransferSample[] = [];
	private readout: TransferReadout | null = null;
	private publishedAt = -Infinity;
	private readonly now: () => number;

	constructor(now: () => number = () => performance.now()) {
		this.now = now;
	}

	sample(loaded: number, total: number): TransferReadout | null {
		if (total > 0 && loaded >= total) return null;
		const at = this.now();
		this.samples.push({ at, loaded });
		while (this.samples.length > 1 && at - this.samples[1].at >= WINDOW_MS) {
			this.samples.shift();
		}
		if (at - this.publishedAt < READOUT_INTERVAL_MS) return this.readout;

		const anchor = this.samples[0];
		const elapsedMs = at - anchor.at;
		if (elapsedMs < READOUT_INTERVAL_MS) return this.readout;

		const bytesPerSecond = ((loaded - anchor.loaded) * 1000) / elapsedMs;
		this.readout = {
			bytesPerSecond,
			secondsLeft: bytesPerSecond > 0 && total > 0 ? (total - loaded) / bytesPerSecond : null
		};
		this.publishedAt = at;
		return this.readout;
	}
}
