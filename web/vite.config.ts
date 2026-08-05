import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { postframeWasm } from './wasm.plugin.ts';

const isolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless',
	'Origin-Agent-Cluster': '?1'
};

export default defineConfig({
	server: { headers: isolationHeaders },
	preview: { headers: isolationHeaders },
	plugins: [
		postframeWasm(),
		tailwindcss(),
		sveltekit({
			adapter: adapter()
		})
	]
});
