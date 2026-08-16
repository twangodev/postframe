export function formatDuration(seconds: number) {
	const wholeSeconds = Math.max(1, Math.round(seconds));
	if (wholeSeconds < 60) return `${wholeSeconds} s`;

	const minutes = Math.round(wholeSeconds / 60);
	if (minutes < 60) return `${minutes} min`;

	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
}
