export function formatError(context: string, error: unknown) {
	const detail =
		error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
	return `${context}\n${detail}`;
}

export function reportError(context: string, error: unknown) {
	console.error(formatError(context, error));
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
