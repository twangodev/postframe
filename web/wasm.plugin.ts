import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const crate = fileURLToPath(new URL('..', import.meta.url));
const watched = ['src', 'Cargo.toml'].map((path) =>
	fileURLToPath(new URL(`../${path}`, import.meta.url))
);

const isRust = (path: string) => path.endsWith('.rs') || path.endsWith('Cargo.toml');

const build = (optimize: boolean) =>
	new Promise<void>((resolve, reject) =>
		spawn(
			'wasm-pack',
			[
				'build',
				crate,
				'--target',
				'web',
				'--out-dir',
				'web/src/lib/pf',
				'--no-pack',
				'--release',
				...(optimize ? [] : ['--no-opt']),
				'--',
				'--no-default-features',
				'--features',
				'wasm'
			],
			{ stdio: 'inherit' }
		)
			.on('error', reject)
			.on('close', (code) =>
				code ? reject(new Error(`wasm-pack exited with code ${code}`)) : resolve()
			)
	);

const debounce = (run: () => void, ms: number) => {
	let timer: ReturnType<typeof setTimeout>;
	return () => {
		clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
};

export const postframeWasm = (): Plugin => {
	let optimize = true;
	let initial: Promise<void> | undefined;

	return {
		name: 'postframe-wasm',

		configResolved({ command }) {
			optimize = command === 'build';
		},

		buildStart() {
			return (initial ??= build(optimize));
		},

		configureServer(server) {
			let building = false;
			let queued = false;

			const rebuild = async () => {
				if (building) {
					queued = true;
					return;
				}
				building = true;
				try {
					await build(optimize);
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
			server.watcher.on('all', (_, path) => isRust(path) && schedule());
		}
	};
};
