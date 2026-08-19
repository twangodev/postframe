const RENDERS_VALID_SINCE = '2026-08-19';

export function renderCacheStorageName(photoId: string) {
	return `render-${RENDERS_VALID_SINCE}-${photoId}.pfc`;
}
