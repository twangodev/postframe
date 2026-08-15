const OPFS_IO_CHUNK_SIZE = 4 * 1024 * 1024;
const READ_PROGRESS_STEP = OPFS_IO_CHUNK_SIZE;

export async function fileSize(handle: FileSystemFileHandle) {
	return handle.getFile().then((file) => file.size);
}

export async function readFile(
	handle: FileSystemFileHandle,
	expectedSize: number,
	onProgress: (completed: number) => void
) {
	const syncHandle = handle as FileSystemFileHandle & {
		createSyncAccessHandle?: () => Promise<{
			getSize: () => number;
			read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
			close: () => void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle !== 'function') {
		const file = await handle.getFile();
		const bytes = new Uint8Array(file.size);
		const reader = file.stream().getReader();
		let offset = 0;
		let reported = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes.set(value, offset);
			offset += value.byteLength;
			if (offset === bytes.byteLength || offset - reported >= READ_PROGRESS_STEP) {
				reported = offset;
				onProgress(offset);
			}
		}
		if (offset !== bytes.byteLength) throw new Error(`Unable to finish reading ${handle.name}`);
		return bytes.buffer;
	}

	const access = await syncHandle.createSyncAccessHandle();
	try {
		const bytes = new Uint8Array(access.getSize());
		let offset = 0;
		while (offset < bytes.byteLength) {
			const end = Math.min(offset + READ_PROGRESS_STEP, bytes.byteLength);
			const read = access.read(bytes.subarray(offset, end), { at: offset });
			if (read === 0) throw new Error(`Unable to finish reading ${handle.name}`);
			offset += read;
			onProgress(Math.min(offset, expectedSize));
		}
		return bytes.buffer;
	} finally {
		access.close();
	}
}

export async function writeFileHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
	const syncHandle = handle as FileSystemFileHandle & {
		createSyncAccessHandle?: () => Promise<{
			write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
			truncate: (size: number) => void;
			flush: () => void;
			close: () => void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle === 'function') {
		const access = await syncHandle.createSyncAccessHandle();
		try {
			access.truncate(0);
			let offset = 0;
			while (offset < bytes.byteLength) {
				const chunkEnd = Math.min(offset + OPFS_IO_CHUNK_SIZE, bytes.byteLength);
				while (offset < chunkEnd) {
					const written = access.write(bytes.subarray(offset, chunkEnd), { at: offset });
					if (written === 0) throw new Error(`Unable to write ${handle.name}`);
					offset += written;
				}
				await yieldToWorker();
			}
			access.flush();
		} finally {
			access.close();
		}
		return;
	}
	const writable = await handle.createWritable();
	try {
		for (let offset = 0; offset < bytes.byteLength; offset += OPFS_IO_CHUNK_SIZE) {
			const chunk = new Uint8Array(
				bytes.subarray(offset, Math.min(offset + OPFS_IO_CHUNK_SIZE, bytes.byteLength))
			);
			await writable.write(chunk);
			await yieldToWorker();
		}
		await writable.close();
	} catch (error) {
		await writable.abort();
		throw error;
	}
}

function yieldToWorker() {
	return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
