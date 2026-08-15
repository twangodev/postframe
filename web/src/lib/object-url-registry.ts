export class ObjectUrlRegistry {
	private readonly urls = new Set<string>();

	add(url: string) {
		this.urls.add(url);
	}

	revoke(url: string) {
		URL.revokeObjectURL(url);
		this.urls.delete(url);
	}

	tracks(url: string) {
		return this.urls.has(url);
	}

	revokeAll() {
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
	}
}
