const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number | null | undefined) {
	if (bytes === null || bytes === undefined) return '—';
	if (bytes === 0) return '0 B';

	const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
	const value = bytes / 1024 ** unit;
	return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}
