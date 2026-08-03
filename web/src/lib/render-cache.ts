const RENDER_CACHE_VERSION = 1;

export function renderCacheStorageName(photoId: string) {
	return `render-v${RENDER_CACHE_VERSION}-${photoId}.pfc`;
}
