<script lang="ts">
	import type { Request, Response } from '$lib/worker';

	let status = $state('open a bracket: the RAF files and, if you have them, their JPEGs');
	let busy = $state(false);
	let merged = $state(false);
	let boostStops = $state(0);
	let ev = $state(0);
	let tone = $state(false);
	let hdrShown = $state(false);
	let previewUrl = $state('');

	let worker: Worker | undefined;
	let previewPending = false;
	let previewQueued = false;

	function ensureWorker(): Worker {
		if (worker) return worker;
		worker = new Worker(new URL('$lib/worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<Response>) => {
			const message = event.data;
			switch (message.type) {
				case 'progress':
					status = message.text;
					break;
				case 'merged':
					merged = true;
					busy = false;
					boostStops = message.boostStops;
					status = `merged — ${boostStops.toFixed(2)} stops of recovered headroom`;
					requestPreview();
					break;
				case 'preview':
				case 'ultra':
					showJpeg(message.jpeg);
					hdrShown = message.type === 'ultra';
					previewPending = false;
					if (previewQueued) {
						previewQueued = false;
						requestPreview();
					}
					break;
				case 'export': {
					const url = URL.createObjectURL(new Blob([message.jpeg], { type: 'image/jpeg' }));
					const link = document.createElement('a');
					link.href = url;
					link.download = 'postframe.jpg';
					link.click();
					URL.revokeObjectURL(url);
					busy = false;
					status = 'exported';
					break;
				}
				case 'error':
					busy = false;
					status = message.message;
					break;
			}
		};
		return worker;
	}

	function send(message: Request, transfer: Transferable[] = []) {
		ensureWorker().postMessage(message, transfer);
	}

	function showJpeg(bytes: ArrayBuffer) {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
	}

	function requestPreview() {
		if (!merged) return;
		if (previewPending) {
			previewQueued = true;
			return;
		}
		previewPending = true;
		send({ type: 'preview', ev, tone });
	}

	async function openFiles(list: FileList | null) {
		if (!list || list.length === 0) return;
		const files = [...list];
		const rafs = files.filter((f) => f.name.toLowerCase().endsWith('.raf'));
		if (rafs.length < 2) {
			status = 'pick at least two RAF files from one bracket';
			return;
		}
		const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();
		const jpegs = new Map(
			files.filter((f) => /\.jpe?g$/i.test(f.name)).map((f) => [stem(f.name), f])
		);

		busy = true;
		merged = false;
		status = 'reading files';
		const frames = await Promise.all(
			rafs.map(async (raf) => ({
				raf: await raf.arrayBuffer(),
				jpeg: await jpegs.get(stem(raf.name))?.arrayBuffer()
			}))
		);
		send({ type: 'load', frames }, frames.flatMap((f) => (f.jpeg ? [f.raf, f.jpeg] : [f.raf])));
	}

	function showHdr() {
		status = 'encoding hdr preview';
		send({ type: 'ultra' });
	}

	function exportUltra() {
		busy = true;
		status = 'encoding export';
		send({ type: 'export' });
	}
</script>

<main>
	<aside>
		<h1>postframe</h1>
		<label class="open">
			open bracket
			<input
				type="file"
				multiple
				accept=".raf,.RAF,.jpg,.JPG,.jpeg,.JPEG"
				onchange={(e) => openFiles(e.currentTarget.files)}
			/>
		</label>

		{#if merged}
			<label>
				EV <span>{ev.toFixed(1)}</span>
				<input type="range" min="-4" max="4" step="0.1" bind:value={ev} oninput={requestPreview} />
			</label>
			<label class="row">
				<input type="checkbox" bind:checked={tone} onchange={requestPreview} />
				tone-map highlights
			</label>
			<button onclick={showHdr} disabled={busy}>HDR preview</button>
			<button onclick={exportUltra} disabled={busy}>export Ultra HDR</button>
			{#if hdrShown}
				<p class="hint">showing the gain-mapped image — highlights light up on HDR displays</p>
			{/if}
		{/if}

		<p class="status">{status}</p>
	</aside>

	<section>
		{#if previewUrl}
			<img src={previewUrl} alt="merged bracket preview" />
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #111;
		color: #ddd;
		font: 14px/1.5 system-ui, sans-serif;
	}
	main {
		display: grid;
		grid-template-columns: 240px 1fr;
		height: 100vh;
	}
	aside {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-right: 1px solid #2a2a2a;
	}
	h1 {
		font-size: 16px;
		margin: 0;
	}
	section {
		display: grid;
		place-items: center;
		overflow: hidden;
	}
	img {
		max-width: 100%;
		max-height: 100vh;
		object-fit: contain;
	}
	.open input {
		display: none;
	}
	.open {
		border: 1px solid #444;
		border-radius: 6px;
		padding: 8px;
		text-align: center;
		cursor: pointer;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	button {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 6px;
		padding: 8px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
	}
	.status {
		margin-top: auto;
		color: #888;
	}
	.hint {
		color: #8a8;
		font-size: 12px;
	}
	input[type='range'] {
		width: 100%;
	}
</style>
