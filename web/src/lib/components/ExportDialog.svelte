<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { Check, Download } from '@lucide/svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { DEFAULT_EXPORT_QUALITY, exportProgressPercent, type ExportPhase } from '$lib/export';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		open?: boolean;
		workspace: WorkspaceState;
	}

	type ExportStatus =
		| { kind: 'idle' }
		| { kind: 'exporting'; phase: ExportPhase; percent: number }
		| { kind: 'completed'; fileName: string }
		| { kind: 'error'; message: string };

	const phaseLabels: Record<ExportPhase, string> = {
		decode: 'reading original',
		develop: 'developing',
		encode: 'encoding jpeg'
	};

	let { open = $bindable(false), workspace }: Props = $props();
	let quality = $state(DEFAULT_EXPORT_QUALITY);
	let status = $state<ExportStatus>({ kind: 'idle' });
	let exportRevision = 0;

	const canExport = $derived(workspace.canAdjustLight);
	const exporting = $derived(status.kind === 'exporting');

	function handleOpenChange(value: boolean) {
		if (value) return;
		exportRevision += 1;
		status = { kind: 'idle' };
	}

	async function finish(event: SubmitEvent) {
		event.preventDefault();
		if (exporting || !canExport) return;
		const revision = ++exportRevision;
		status = { kind: 'exporting', phase: 'decode', percent: 0 };
		try {
			const result = await workspace.exportPhoto({ quality }, (progress) => {
				if (revision !== exportRevision) return;
				status = {
					kind: 'exporting',
					phase: progress.phase,
					percent: exportProgressPercent(progress)
				};
			});
			if (revision !== exportRevision) return;
			download(result.jpeg, result.fileName);
			status = { kind: 'completed', fileName: result.fileName };
			setTimeout(() => {
				if (revision === exportRevision) open = false;
			}, 1200);
		} catch (error) {
			if (revision !== exportRevision) return;
			status = {
				kind: 'error',
				message: error instanceof Error ? error.message : 'Unable to export the photograph'
			};
		}
	}

	function download(jpeg: ArrayBuffer, fileName: string) {
		const url = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<DialogShell bind:open onOpenChange={handleOpenChange}>
	<form onsubmit={finish}>
		<DialogHeader
			class="border-b border-subtle p-5"
			eyebrow={{ icon: Download, label: 'export' }}
			title={workspace.selectedPhoto?.name ?? 'photograph'}
			description="render the photograph at full resolution with your edits applied."
		/>

		<div class="space-y-5 p-5">
			<label class="block">
				<span class="mb-1.5 flex justify-between text-[11px] tracking-[0.04em] text-muted">
					<span>quality</span><span class="font-mono">{quality}</span>
				</span>
				<input
					type="range"
					min="1"
					max="100"
					bind:value={quality}
					disabled={exporting}
					class="w-full accent-accent"
				/>
			</label>

			{#if !canExport}
				<p class="rounded border border-subtle bg-surface/45 p-3 text-[11px] text-muted">
					open this photograph in the edit view to export it.
				</p>
			{:else if status.kind === 'exporting' || status.kind === 'completed'}
				<div class="space-y-2 rounded border border-subtle bg-surface/45 p-3">
					<div class="flex justify-between text-[11px] tracking-[0.04em] text-muted">
						<span>{status.kind === 'completed' ? 'saved' : phaseLabels[status.phase]}</span>
						<span class="font-mono">{status.kind === 'completed' ? 100 : status.percent}%</span>
					</div>
					<div class="h-1 overflow-hidden rounded-full bg-subtle">
						<div
							class="h-full rounded-full bg-accent transition-[width] duration-200"
							style:width="{status.kind === 'completed' ? 100 : status.percent}%"
						></div>
					</div>
					{#if status.kind === 'completed'}
						<p class="font-mono text-[11px] text-positive">{status.fileName}</p>
					{/if}
				</div>
			{:else if status.kind === 'error'}
				<p class="rounded border border-subtle bg-surface/45 p-3 text-[11px] text-negative">
					{status.message}
				</p>
			{/if}
		</div>

		<div class="flex items-center justify-between border-t border-subtle p-4">
			<p class="font-mono text-[11px] tracking-wide text-muted">
				JPEG · quality {quality}
			</p>
			<div class="flex gap-2">
				<Dialog.Close
					class="cursor-pointer rounded border border-subtle px-3 py-2 text-[11px] text-muted hover:text-text"
				>
					cancel
				</Dialog.Close>
				<button
					type="submit"
					disabled={!canExport || exporting}
					class="flex min-w-28 cursor-pointer items-center justify-center gap-1.5 rounded bg-text px-3 py-2 text-[11px] text-bg disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if status.kind === 'completed'}
						<Check size={12} /> saved
					{:else if exporting}
						exporting…
					{:else}
						<Download size={12} /> export
					{/if}
				</button>
			</div>
		</div>
	</form>
</DialogShell>
