import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const MODEL_ROUTE = '/models/segnext/';
const MODEL_FILES = new Set(['encoder.fp32.onnx', 'decoder.fp32.onnx']);
const MODEL_DIRECTORY = new URL('../models/postframe-segnext/', import.meta.url);

export function postframeModels(): Plugin {
	return {
		name: 'postframe-models',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const filename = requestedModel(request.url);
				if (!filename) return next();

				try {
					const model = fileURLToPath(new URL(filename, MODEL_DIRECTORY));
					const metadata = await stat(model);
					response.statusCode = 200;
					response.setHeader('Content-Type', 'application/octet-stream');
					response.setHeader('Content-Length', metadata.size);
					response.setHeader('Cache-Control', 'no-store');
					createReadStream(model).pipe(response);
				} catch (error) {
					next(error as Error);
				}
			});
		}
	};
}

function requestedModel(requestUrl: string | undefined) {
	const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname;
	if (!pathname.startsWith(MODEL_ROUTE)) return;
	const filename = pathname.slice(MODEL_ROUTE.length);
	return MODEL_FILES.has(filename) ? filename : undefined;
}
