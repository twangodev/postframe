import { spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const crate = fileURLToPath(new URL('..', import.meta.url));
const watched = ['src', 'Cargo.toml', 'Cargo.lock', '.cargo/config.toml'].map((path) =>
	fileURLToPath(new URL(`../${path}`, import.meta.url))
);
const standardOutput = fileURLToPath(new URL('src/lib/pf', import.meta.url));
const threadedOutput = fileURLToPath(new URL('src/lib/pf-threaded', import.meta.url));
const threadedPackage = JSON.stringify({
	name: 'postframe-threaded',
	private: true,
	type: 'module',
	main: 'postframe.js',
	module: 'postframe.js',
	types: 'postframe.d.ts',
	exports: { '.': './postframe.js' }
});
const nightly = 'nightly-2025-11-15';
const threadedRustFlags = [
	'-C target-feature=+simd128,+atomics,+bulk-memory',
	'-C link-arg=--shared-memory',
	'-C link-arg=--max-memory=2147483648',
	'-C link-arg=--import-memory',
	'-C link-arg=--export=__wasm_init_tls',
	'-C link-arg=--export=__tls_size',
	'-C link-arg=--export=__tls_align',
	'-C link-arg=--export=__tls_base'
].join(' ');

const isBuildInput = (path: string) =>
	path.endsWith('.rs') ||
	path.endsWith('Cargo.toml') ||
	path.endsWith('Cargo.lock') ||
	path.endsWith('.cargo/config.toml');

const run = (command: string, args: string[], env = process.env) =>
	new Promise<void>((resolve, reject) =>
		spawn(command, args, { stdio: 'inherit', env })
			.on('error', reject)
			.on('close', (code) =>
				code ? reject(new Error(`${command} exited with code ${code}`)) : resolve()
			)
	);

const wasmPackArguments = (outDir: string, feature: string, optimize: boolean) => [
	'build',
	crate,
	'--target',
	'web',
	'--out-dir',
	outDir,
	'--no-pack',
	'--release',
	...(optimize ? [] : ['--no-opt']),
	'--',
	'--no-default-features',
	'--features',
	feature
];

const buildStandard = (optimize: boolean) =>
	run('wasm-pack', wasmPackArguments('web/src/lib/pf', 'wasm', optimize));

const buildThreaded = (optimize: boolean) =>
	run(
		'rustup',
		[
			'run',
			nightly,
			'wasm-pack',
			...wasmPackArguments('web/src/lib/pf-threaded', 'wasm-threads', optimize),
			'-Z',
			'build-std=panic_abort,std'
		],
		{ ...process.env, RUSTFLAGS: threadedRustFlags }
	);

const build = async (optimize: boolean) => {
	if (await artifactsAreCurrent(optimize)) return;
	await buildStandard(optimize);
	await buildThreaded(optimize);
	await Promise.all([
		writeFile(join(threadedOutput, 'package.json'), threadedPackage),
		writeFile(buildMarker(standardOutput), buildProfile(optimize)),
		writeFile(buildMarker(threadedOutput), buildProfile(optimize))
	]);
};

const buildMarker = (output: string) => join(output, '.postframe-build');
const buildProfile = (optimize: boolean) => (optimize ? 'release' : 'development');

async function artifactsAreCurrent(optimize: boolean) {
	try {
		const markers = [buildMarker(standardOutput), buildMarker(threadedOutput)];
		const expected = buildProfile(optimize);
		const profiles = await Promise.all(markers.map((marker) => readFile(marker, 'utf8')));
		if (profiles.some((profile) => profile.trim() !== expected)) return false;
		const [sourceMtime, ...markerStats] = await Promise.all([
			newestSourceMtime(),
			...markers.map((marker) => stat(marker))
		]);
		return markerStats.every((marker) => marker.mtimeMs >= sourceMtime);
	} catch {
		return false;
	}
}

async function newestSourceMtime() {
	const sourceMtime = await newestMtime(join(crate, 'src'));
	const fileStats = await Promise.all(
		['Cargo.toml', 'Cargo.lock', '.cargo/config.toml'].map((path) => stat(join(crate, path)))
	);
	return Math.max(sourceMtime, ...fileStats.map((file) => file.mtimeMs));
}

async function newestMtime(directory: string): Promise<number> {
	const entries = await readdir(directory, { withFileTypes: true });
	const mtimes = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? newestMtime(path) : stat(path).then((file) => file.mtimeMs);
		})
	);
	return Math.max(0, ...mtimes);
}

const debounce = (run: () => void, ms: number) => {
	let timer: ReturnType<typeof setTimeout>;
	return () => {
		clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
};

export const postframeWasm = (): Plugin[] => [
	{
		name: 'postframe-wasm-build',
		apply: 'build',
		buildStart: () => build(true)
	},
	{
		name: 'postframe-wasm-development',
		apply: 'serve',
		async configureServer(server) {
			await build(false);
			let building = false;
			let queued = false;

			const rebuild = async () => {
				if (building) {
					queued = true;
					return;
				}
				building = true;
				try {
					await build(false);
					server.hot.send({ type: 'full-reload' });
				} catch (error) {
					server.config.logger.error(`postframe: ${error}`);
				} finally {
					building = false;
					if (queued) {
						queued = false;
						void rebuild();
					}
				}
			};

			const schedule = debounce(() => void rebuild(), 100);

			server.watcher.add(watched);
			server.watcher.on('all', (_, path) => isBuildInput(path) && schedule());
		}
	}
];
