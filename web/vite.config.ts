import adapter from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { postframeWasm } from './wasm.plugin.ts';

const isolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless',
	'Origin-Agent-Cluster': '?1'
};

const desktop = process.env.POSTFRAME_TARGET === 'desktop';

export default defineConfig({
	server: { headers: isolationHeaders },
	preview: { headers: isolationHeaders },
	plugins: [
		postframeWasm(),
		tailwindcss(),
		sveltekit({
			adapter: desktop ? staticAdapter({ fallback: 'index.html' }) : adapter()
		})
	]
});
