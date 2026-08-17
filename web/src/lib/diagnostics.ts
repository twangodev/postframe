export function formatError(context: string, error: unknown) {
	const detail =
		error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
	return `${context}\n${detail}`;
}

export function reportError(context: string, error: unknown) {
	console.error(formatError(context, error));
}

/**
 * Releases a wasm handle without letting the release replace the failure that
 * prompted it. A panic inside Rust leaves wasm-bindgen's borrow flag set, so
 * freeing afterwards throws and would otherwise mask the original error.
 */
export function freeQuietly(context: string, handle: { free(): void }) {
	try {
		handle.free();
	} catch (error) {
		reportError(`${context}: releasing the wasm handle failed`, error);
	}
}

/** Surfaces what the runtime would otherwise report without a stack. */
export function reportUncaught(scope: string, target: EventTarget) {
	target.addEventListener('error', (event) => {
		const failure = event as ErrorEvent;
		reportError(`${scope} uncaught error at ${failure.filename}:${failure.lineno}`, failure.error);
	});
	target.addEventListener('unhandledrejection', (event) => {
		reportError(`${scope} unhandled rejection`, (event as PromiseRejectionEvent).reason);
	});
}
