import { AssetStore } from './asset-store.ts';

interface ModelCacheEntry {
	key: string;
	digest: string;
	contentType: string;
}

export class OpfsModelCache {
	private readonly assets: AssetStore;

	constructor(assets = new AssetStore()) {
		this.assets = assets;
	}

	async match(key: string) {
		const name = await modelCacheName(key);
		const [contents, metadata] = await Promise.all([
			this.assets.readModel(`${name}.bin`),
			this.assets.readModel(`${name}.json`)
		]);
		if (!contents || !metadata) return undefined;

		const entry = JSON.parse(await metadata.text()) as ModelCacheEntry;
		if (entry.key !== key || entry.digest !== (await digest(await contents.arrayBuffer()))) {
			return undefined;
		}
		return new Response(contents, { headers: { 'content-type': entry.contentType } });
	}

	async put(
		key: string,
		response: Response,
		onProgress?: (progress: { progress: number; loaded: number; total: number }) => void
	) {
		const bytes = await response.arrayBuffer();
		const name = await modelCacheName(key);
		const entry = {
			key,
			digest: await digest(bytes),
			contentType: response.headers.get('content-type') ?? 'application/octet-stream'
		} satisfies ModelCacheEntry;
		await Promise.all([
			this.assets.writeModel(`${name}.bin`, bytes),
			this.assets.writeModel(
				`${name}.json`,
				new Blob([JSON.stringify(entry)], { type: 'application/json' })
			)
		]);
		onProgress?.({ progress: 100, loaded: bytes.byteLength, total: bytes.byteLength });
	}
}

export async function modelCacheName(key: string) {
	return digest(new TextEncoder().encode(key));
}

async function digest(contents: BufferSource) {
	const bytes = await crypto.subtle.digest('SHA-256', contents);
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
