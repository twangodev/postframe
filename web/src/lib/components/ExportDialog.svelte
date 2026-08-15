<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { Check, Download, X } from '@lucide/svelte';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';
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

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
		<CenteredDialogContent>
			<form onsubmit={finish}>
				<div class="border-subtle flex items-start justify-between border-b p-5">
					<div>
						<div class="text-muted mb-2 flex items-center gap-2">
							<Download size={14} strokeWidth={1.4} />
							<span class="text-[11px] tracking-[0.04em]">export</span>
						</div>
						<Dialog.Title class="text-sm font-medium tracking-tight">
							{workspace.selectedPhoto?.name ?? 'photograph'}
						</Dialog.Title>
						<Dialog.Description class="text-muted mt-1 text-xs">
							render the photograph at full resolution with your edits applied.
						</Dialog.Description>
					</div>
					<Dialog.Close
						class="text-muted hover:text-text cursor-pointer rounded p-1"
						aria-label="Close"
					>
						<X size={16} />
					</Dialog.Close>
				</div>

				<div class="space-y-5 p-5">
					<label class="block">
						<span class="text-muted mb-1.5 flex justify-between text-[11px] tracking-[0.04em]">
							<span>quality</span><span class="font-mono">{quality}</span>
						</span>
						<input
							type="range"
							min="1"
							max="100"
							bind:value={quality}
							disabled={exporting}
							class="accent-accent w-full"
						/>
					</label>

					{#if !canExport}
						<p class="border-subtle bg-surface/45 text-muted rounded border p-3 text-[11px]">
							open this photograph in the edit view to export it.
						</p>
					{:else if status.kind === 'exporting' || status.kind === 'completed'}
						<div class="border-subtle bg-surface/45 space-y-2 rounded border p-3">
							<div class="text-muted flex justify-between text-[11px] tracking-[0.04em]">
								<span>{status.kind === 'completed' ? 'saved' : phaseLabels[status.phase]}</span>
								<span class="font-mono">{status.kind === 'completed' ? 100 : status.percent}%</span>
							</div>
							<div class="bg-subtle h-1 overflow-hidden rounded-full">
								<div
									class="bg-accent h-full rounded-full transition-[width] duration-200"
									style:width="{status.kind === 'completed' ? 100 : status.percent}%"
								></div>
							</div>
							{#if status.kind === 'completed'}
								<p class="text-positive font-mono text-[11px]">{status.fileName}</p>
							{/if}
						</div>
					{:else if status.kind === 'error'}
						<p class="border-subtle bg-surface/45 text-negative rounded border p-3 text-[11px]">
							{status.message}
						</p>
					{/if}
				</div>

				<div class="border-subtle flex items-center justify-between border-t p-4">
					<p class="text-muted font-mono text-[11px] tracking-wide">
						JPEG · quality {quality}
					</p>
					<div class="flex gap-2">
						<Dialog.Close
							class="border-subtle text-muted hover:text-text cursor-pointer rounded border px-3 py-2 text-[11px]"
						>
							cancel
						</Dialog.Close>
						<button
							type="submit"
							disabled={!canExport || exporting}
							class="bg-text text-bg flex min-w-28 cursor-pointer items-center justify-center gap-1.5 rounded px-3 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
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
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>
