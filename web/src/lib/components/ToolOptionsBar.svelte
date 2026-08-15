<script lang="ts">
	import { RotateCcw } from '@lucide/svelte';
	import {
		cropTools,
		generativeTools,
		measureTools,
		paintTools,
		retouchTools,
		selectionTools,
		typeTools,
		vectorTools
	} from '$lib/editor-tools';

	interface Props {
		activeTool: string;
		activeToolLabel: string;
		maskBrushOperation: 'add' | 'subtract';
		refineBrushSize: number;
	}

	let { activeTool, activeToolLabel, maskBrushOperation, refineBrushSize }: Props = $props();
</script>

<div
	class="border-subtle bg-bg text-muted flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 text-[11px]"
>
	<span class="text-text shrink-0 font-medium">{activeToolLabel}</span>
	<span class="bg-subtle h-4 w-px shrink-0"></span>

	{#if activeTool === 'object-select'}
		<span class="shrink-0">paint to include</span>
		<span class="text-muted shrink-0">
			<kbd class="text-text font-mono">alt</kbd> paint to exclude
		</span>
	{:else if selectionTools.has(activeTool)}
		<!-- TODO(WASM_TODOS.editorTools): implement remaining pixel selection tools. -->
		<div class="border-subtle bg-surface flex h-6 shrink-0 rounded border p-0.5">
			{#each ['new', 'add', 'subtract', 'intersect'] as mode, index}
				<button
					type="button"
					title={`${mode} selection`}
					class="hover:bg-elevated hover:text-text flex min-w-6 cursor-pointer items-center justify-center rounded-sm px-1.5 {index ===
					0
						? 'bg-elevated text-text'
						: ''}"
				>
					{mode === 'new' ? '□' : mode === 'add' ? '+' : mode === 'subtract' ? '−' : '∩'}
				</button>
			{/each}
		</div>
		{#if activeTool === 'magic-wand'}
			<span class="shrink-0">tolerance <span class="text-text font-mono">32</span></span>
		{/if}
		<span class="shrink-0">feather <span class="text-text font-mono">0 px</span></span>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" checked class="accent-accent size-3" /> anti-alias
		</label>
		{#if activeTool === 'magic-wand'}
			<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
				<input type="checkbox" checked class="accent-accent size-3" /> contiguous
			</label>
		{/if}
	{:else if cropTools.has(activeTool)}
		<button
			type="button"
			class="border-subtle bg-surface text-text h-6 shrink-0 cursor-pointer rounded border px-2"
		>
			original ratio
		</button>
		<span class="shrink-0 font-mono">— × —</span>
		<button
			type="button"
			class="hover:bg-surface hover:text-text flex size-6 shrink-0 cursor-pointer items-center justify-center rounded"
			aria-label="Straighten"
		>
			<RotateCcw size={12} />
		</button>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" class="accent-accent size-3" /> delete cropped pixels
		</label>
	{:else if retouchTools.has(activeTool) || paintTools.has(activeTool)}
		<button
			type="button"
			class="border-subtle bg-surface text-text flex h-6 shrink-0 cursor-pointer items-center gap-2 rounded border px-2"
		>
			<span class="size-3 rounded-full border border-current"></span>
			<span class="font-mono">42 px</span>
		</button>
		<span class="shrink-0">hardness <span class="text-text font-mono">65%</span></span>
		<span class="shrink-0">opacity <span class="text-text font-mono">100%</span></span>
		{#if ['brush', 'pencil', 'mixer-brush'].includes(activeTool)}
			<span class="shrink-0">flow <span class="text-text font-mono">100%</span></span>
		{:else}
			<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
				<input type="checkbox" checked class="accent-accent size-3" /> sample all layers
			</label>
		{/if}
	{:else if typeTools.has(activeTool)}
		<button class="border-subtle bg-surface text-text h-6 shrink-0 rounded border px-2">
			Overused Grotesk
		</button>
		<span class="shrink-0 font-mono">32 px</span>
		<span class="shrink-0">regular</span>
		<div class="border-subtle bg-surface size-4 shrink-0 rounded-sm border"></div>
	{:else if vectorTools.has(activeTool)}
		<button class="border-subtle bg-surface text-text h-6 shrink-0 rounded border px-2">
			path
		</button>
		<span class="shrink-0">fill</span>
		<div class="border-subtle bg-text size-4 shrink-0 rounded-sm border"></div>
		<span class="shrink-0">stroke <span class="text-text font-mono">1 px</span></span>
	{:else if measureTools.has(activeTool)}
		<span class="shrink-0">sample <span class="text-text font-mono">5 × 5</span></span>
		<span class="shrink-0">scale <span class="text-text font-mono">1 px : 1 px</span></span>
	{:else if generativeTools.has(activeTool)}
		<!-- TODO(WASM_TODOS.generative): run the provider and composite through the planned binding. -->
		<input
			placeholder="describe an edit"
			class="border-subtle bg-surface placeholder:text-muted/60 focus:border-accent h-6 min-w-48 rounded border px-2 focus:outline-none"
		/>
		<button class="bg-text text-bg h-6 shrink-0 cursor-pointer rounded px-2">generate</button>
	{:else if activeTool === 'mask-linear' || activeTool === 'mask-radial'}
		<span class="shrink-0">
			drag on the photo to place the {activeTool === 'mask-linear' ? 'linear' : 'radial'} gradient
		</span>
	{:else if activeTool.startsWith('mask')}
		<span class="shrink-0">size <span class="text-text font-mono">{refineBrushSize} px</span></span>
		<span class="shrink-0">feather <span class="text-text font-mono">45%</span></span>
		<span class="shrink-0">flow <span class="text-text font-mono">100%</span></span>
		{#if activeTool === 'mask'}
			<span class="shrink-0"
				>mode <span class="text-text font-mono">{maskBrushOperation}</span></span
			>
		{/if}
	{:else}
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" checked class="accent-accent size-3" /> auto-select
		</label>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" class="accent-accent size-3" /> show transform controls
		</label>
	{/if}
</div>
