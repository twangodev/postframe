import { storageNameSchema } from './library-schema';

const APP_DIRECTORY = 'postframe';
const ORIGINALS_DIRECTORY = 'originals';
const THUMBNAILS_DIRECTORY = 'thumbnails';

export interface OriginalWrite {
	storageName: string;
	file: File;
}

export interface ThumbnailWrite {
	storageName: string;
	blob: Blob;
}

type RootProvider = () => Promise<FileSystemDirectoryHandle>;

export class AssetStore {
	private readonly root: RootProvider;

	constructor(root: RootProvider = () => navigator.storage.getDirectory()) {
		this.root = root;
	}

	static supported() {
		return (
			typeof navigator !== 'undefined' &&
			'getDirectory' in navigator.storage &&
			typeof navigator.storage.getDirectory === 'function'
		);
	}

	async readOriginal(storageName: string): Promise<File> {
		return this.originalHandle(storageName).then((handle) => handle.getFile());
	}

	async originalHandle(storageName: string) {
		return this.fileHandle(ORIGINALS_DIRECTORY, storageName);
	}

	async readThumbnail(storageName: string): Promise<File> {
		return this.fileHandle(THUMBNAILS_DIRECTORY, storageName).then((handle) => handle.getFile());
	}

	async writeOriginals(writes: readonly OriginalWrite[]) {
		return this.writeFiles(
			ORIGINALS_DIRECTORY,
			writes.map(({ storageName, file }) => ({ storageName, contents: file }))
		);
	}

	async writeThumbnails(writes: readonly ThumbnailWrite[]) {
		return this.writeFiles(
			THUMBNAILS_DIRECTORY,
			writes.map(({ storageName, blob }) => ({ storageName, contents: blob }))
		);
	}

	async deleteOriginals(storageNames: readonly string[]) {
		await this.deleteFiles(ORIGINALS_DIRECTORY, storageNames);
	}

	async deleteThumbnails(storageNames: readonly string[]) {
		await this.deleteFiles(THUMBNAILS_DIRECTORY, storageNames);
	}

	async clearAll() {
		const root = await this.root();
		try {
			await root.removeEntry(APP_DIRECTORY, { recursive: true });
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
	}

	private async writeFiles(
		folder: string,
		writes: readonly { storageName: string; contents: FileSystemWriteChunkType }[]
	) {
		if (writes.length === 0) return [];
		const directory = await this.fileDirectory(folder, true);
		const created: string[] = [];

		for (const write of writes) {
			storageNameSchema.parse(write.storageName);
			const existed = await fileExists(directory, write.storageName);
			await writeFile(directory, write.storageName, write.contents);
			if (!existed) created.push(write.storageName);
		}

		return created;
	}

	private async deleteFiles(folder: string, storageNames: readonly string[]) {
		if (storageNames.length === 0) return;
		let directory: FileSystemDirectoryHandle;
		try {
			directory = await this.fileDirectory(folder, false);
		} catch (error) {
			if (isNotFoundError(error)) return;
			throw error;
		}

		await Promise.all(
			storageNames.map(async (storageName) => {
				storageNameSchema.parse(storageName);
				try {
					await directory.removeEntry(storageName);
				} catch (error) {
					if (!isNotFoundError(error)) throw error;
				}
			})
		);
	}

	private async fileHandle(folder: string, storageName: string) {
		storageNameSchema.parse(storageName);
		const directory = await this.fileDirectory(folder, false);
		return directory.getFileHandle(storageName);
	}

	private async fileDirectory(folder: string, create: boolean) {
		const root = await this.root();
		const app = await root.getDirectoryHandle(APP_DIRECTORY, { create });
		return app.getDirectoryHandle(folder, { create });
	}
}

async function fileExists(directory: FileSystemDirectoryHandle, name: string) {
	try {
		await directory.getFileHandle(name);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function isNotFoundError(error: unknown) {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

async function writeFile(
	directory: FileSystemDirectoryHandle,
	name: string,
	contents: FileSystemWriteChunkType
) {
	const handle = await directory.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	try {
		await writable.write(contents);
		await writable.close();
	} catch (error) {
		await writable.abort();
		throw error;
	}
}
