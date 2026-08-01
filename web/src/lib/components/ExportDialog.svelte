<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { Check, Download, X } from '@lucide/svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		open?: boolean;
		workspace: WorkspaceState;
	}

	let { open = $bindable(false), workspace }: Props = $props();
	let format = $state('jpeg');
	let quality = $state(92);
	let colorSpace = $state('display-p3');
	let hdr = $state(true);
	let resize = $state(false);
	let longEdge = $state(4096);
	let completed = $state(false);

	function finish(event: SubmitEvent) {
		event.preventDefault();
		completed = true;
		setTimeout(() => {
			open = false;
			completed = false;
		}, 550);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content
			class="motion-dialog-content border-subtle bg-bg fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border shadow-2xl"
		>
			<form onsubmit={finish}>
				<div class="border-subtle flex items-start justify-between border-b p-5">
					<div>
						<div class="text-muted mb-2 flex items-center gap-2">
							<Download size={14} strokeWidth={1.4} />
							<span class="text-[10px] tracking-[0.04em]">export</span>
						</div>
						<Dialog.Title class="text-sm font-medium tracking-tight">
							{workspace.selectedIds.length > 1
								? `${workspace.selectedIds.length} photographs`
								: (workspace.selectedPhoto?.name ?? 'photograph')}
						</Dialog.Title>
						<Dialog.Description class="text-muted mt-1 text-xs">
							configure the final render. export is disabled in this UI preview.
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
					<div class="grid grid-cols-2 gap-3">
						<label>
							<span class="text-muted mb-1.5 block text-[10px] tracking-[0.04em]">format</span>
							<select
								bind:value={format}
								class="border-subtle bg-surface focus:border-accent h-9 w-full cursor-pointer rounded border px-2 text-xs focus:outline-none"
							>
								<option value="jpeg">JPEG</option>
								<option value="tiff">TIFF</option>
								<option value="png">PNG</option>
							</select>
						</label>
						<label>
							<span class="text-muted mb-1.5 block text-[10px] tracking-[0.04em]">color space</span>
							<select
								bind:value={colorSpace}
								class="border-subtle bg-surface focus:border-accent h-9 w-full cursor-pointer rounded border px-2 text-xs focus:outline-none"
							>
								<option value="display-p3">Display P3</option>
								<option value="srgb">sRGB</option>
								<option value="adobe-rgb">Adobe RGB</option>
							</select>
						</label>
					</div>

					<label class="block">
						<span class="text-muted mb-1.5 flex justify-between text-[10px] tracking-[0.04em]">
							<span>quality</span><span class="font-mono">{quality}</span>
						</span>
						<input
							type="range"
							min="1"
							max="100"
							bind:value={quality}
							class="accent-accent w-full"
						/>
					</label>

					<div class="border-subtle bg-surface/45 space-y-3 rounded border p-3">
						<label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
							<span>
								<span class="text-text block">Ultra HDR gain map</span>
								<span class="text-muted mt-0.5 block text-[10px]"
									>preserve display headroom in supported viewers.</span
								>
							</span>
							<input type="checkbox" bind:checked={hdr} class="accent-accent" />
						</label>
						<div class="bg-subtle h-px"></div>
						<label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
							<span class="text-text">resize long edge</span>
							<input type="checkbox" bind:checked={resize} class="accent-accent" />
						</label>
						{#if resize}
							<div class="flex items-center gap-2">
								<input
									type="number"
									min="256"
									max="20000"
									step="1"
									bind:value={longEdge}
									class="border-subtle bg-bg focus:border-accent h-8 min-w-0 flex-1 rounded border px-2 font-mono text-[10px] focus:outline-none"
								/>
								<span class="text-muted font-mono text-[10px]">px</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="border-subtle flex items-center justify-between border-t p-4">
					<p class="text-muted font-mono text-[10px] tracking-wide">
						{format.toUpperCase()} · {colorSpace}
					</p>
					<div class="flex gap-2">
						<Dialog.Close
							class="border-subtle text-muted hover:text-text cursor-pointer rounded border px-3 py-2 text-[10px]"
						>
							cancel
						</Dialog.Close>
						<button
							type="submit"
							class="bg-text text-bg flex min-w-28 cursor-pointer items-center justify-center gap-1.5 rounded px-3 py-2 text-[10px]"
						>
							{#if completed}<Check size={12} /> ready{:else}<Download size={12} /> export{/if}
						</button>
					</div>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
