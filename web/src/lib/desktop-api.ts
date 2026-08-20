import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

const WRITE_CHUNK_SIZE = 512 * 1024;

export type DesktopStatus =
	| { kind: 'ready'; path: string }
	| { kind: 'needsLibrary' }
	| { kind: 'error'; message: string };

export interface DesktopAssetSource {
	url: string;
	name: string;
	size: number;
}

export function isTauri() {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const desktopStatus = () => invoke<DesktopStatus>('desktop_status');

export async function createDesktopLibrary() {
	const parentPath = await open({
		directory: true,
		multiple: false,
		title: 'Choose where to create your Postframe Library'
	});
	if (typeof parentPath !== 'string') return null;
	return invoke<string>('create_library', { parentPath });
}

export async function openDesktopLibrary() {
	const path = await open({
		directory: true,
		multiple: false,
		title: 'Open a Postframe Library'
	});
	if (typeof path !== 'string') return null;
	return invoke<string>('open_library', { path });
}

export const revealDesktopLibrary = () => invoke<void>('reveal_library');

export const desktopAssetSource = (kind: string, storageName: string) =>
	invoke<DesktopAssetSource>('asset_source', { kind, storageName });

export const desktopAssetExists = (kind: string, storageName: string) =>
	invoke<boolean>('asset_exists', { kind, storageName });

export async function writeDesktopAsset(
	kind: string,
	storageName: string,
	contents: Blob | Uint8Array,
	expectedHash: string | null = null
) {
	const bytes =
		contents instanceof Uint8Array ? contents : new Uint8Array(await contents.arrayBuffer());
	const token = await invoke<string>('begin_asset_write', {
		kind,
		storageName,
		expectedSize: bytes.byteLength,
		expectedHash
	});
	try {
		await appendWrite(token, bytes);
		await invoke('commit_asset_write', { token });
	} catch (error) {
		await invoke('abort_asset_write', { token }).catch(() => undefined);
		throw error;
	}
}

export async function writeDesktopExport(jpeg: ArrayBuffer, suggestedName: string) {
	const path = await save({
		title: 'Export photograph',
		defaultPath: suggestedName,
		filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
	});
	if (!path) return false;
	const bytes = new Uint8Array(jpeg);
	const token = await invoke<string>('begin_export_write', {
		path,
		expectedSize: bytes.byteLength,
		expectedHash: await sha256(bytes)
	});
	try {
		await appendWrite(token, bytes);
		await invoke('commit_asset_write', { token });
		return true;
	} catch (error) {
		await invoke('abort_asset_write', { token }).catch(() => undefined);
		throw error;
	}
}

async function appendWrite(token: string, bytes: Uint8Array) {
	for (let offset = 0; offset < bytes.byteLength; offset += WRITE_CHUNK_SIZE) {
		const chunk = bytes.subarray(offset, Math.min(offset + WRITE_CHUNK_SIZE, bytes.byteLength));
		await invoke('append_asset_write', { token, offset, data: Array.from(chunk) });
	}
}

async function sha256(bytes: Uint8Array) {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
