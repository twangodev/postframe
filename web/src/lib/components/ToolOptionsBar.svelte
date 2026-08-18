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
	class="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-subtle bg-bg px-3 text-[11px] text-muted"
>
	<span class="shrink-0 font-medium text-text">{activeToolLabel}</span>
	<span class="h-4 w-px shrink-0 bg-subtle"></span>

	{#if activeTool === 'eyedropper'}
		<span class="shrink-0">click a neutral grey or white</span>
	{:else if activeTool === 'object-select'}
		<span class="shrink-0">paint to include</span>
		<span class="shrink-0 text-muted">
			<kbd class="font-mono text-text">alt</kbd> paint to exclude
		</span>
	{:else if selectionTools.has(activeTool)}
		<!-- TODO(WASM_TODOS.editorTools): implement remaining pixel selection tools. -->
		<div class="flex h-6 shrink-0 rounded border border-subtle bg-surface p-0.5">
			{#each ['new', 'add', 'subtract', 'intersect'] as mode, index (mode)}
				<button
					type="button"
					title={`${mode} selection`}
					class="flex min-w-6 cursor-pointer items-center justify-center rounded-sm px-1.5 hover:bg-elevated hover:text-text {index ===
					0
						? 'bg-elevated text-text'
						: ''}"
				>
					{mode === 'new' ? '□' : mode === 'add' ? '+' : mode === 'subtract' ? '−' : '∩'}
				</button>
			{/each}
		</div>
		{#if activeTool === 'magic-wand'}
			<span class="shrink-0">tolerance <span class="font-mono text-text">32</span></span>
		{/if}
		<span class="shrink-0">feather <span class="font-mono text-text">0 px</span></span>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" checked class="size-3 accent-accent" /> anti-alias
		</label>
		{#if activeTool === 'magic-wand'}
			<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
				<input type="checkbox" checked class="size-3 accent-accent" /> contiguous
			</label>
		{/if}
	{:else if cropTools.has(activeTool)}
		<button
			type="button"
			class="h-6 shrink-0 cursor-pointer rounded border border-subtle bg-surface px-2 text-text"
		>
			original ratio
		</button>
		<span class="shrink-0 font-mono">— × —</span>
		<button
			type="button"
			class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-surface hover:text-text"
			aria-label="Straighten"
		>
			<RotateCcw size={12} />
		</button>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" class="size-3 accent-accent" /> delete cropped pixels
		</label>
	{:else if retouchTools.has(activeTool) || paintTools.has(activeTool)}
		<button
			type="button"
			class="flex h-6 shrink-0 cursor-pointer items-center gap-2 rounded border border-subtle bg-surface px-2 text-text"
		>
			<span class="size-3 rounded-full border border-current"></span>
			<span class="font-mono">42 px</span>
		</button>
		<span class="shrink-0">hardness <span class="font-mono text-text">65%</span></span>
		<span class="shrink-0">opacity <span class="font-mono text-text">100%</span></span>
		{#if ['brush', 'pencil', 'mixer-brush'].includes(activeTool)}
			<span class="shrink-0">flow <span class="font-mono text-text">100%</span></span>
		{:else}
			<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
				<input type="checkbox" checked class="size-3 accent-accent" /> sample all layers
			</label>
		{/if}
	{:else if typeTools.has(activeTool)}
		<button class="h-6 shrink-0 rounded border border-subtle bg-surface px-2 text-text">
			Overused Grotesk
		</button>
		<span class="shrink-0 font-mono">32 px</span>
		<span class="shrink-0">regular</span>
		<div class="size-4 shrink-0 rounded-sm border border-subtle bg-surface"></div>
	{:else if vectorTools.has(activeTool)}
		<button class="h-6 shrink-0 rounded border border-subtle bg-surface px-2 text-text">
			path
		</button>
		<span class="shrink-0">fill</span>
		<div class="size-4 shrink-0 rounded-sm border border-subtle bg-text"></div>
		<span class="shrink-0">stroke <span class="font-mono text-text">1 px</span></span>
	{:else if measureTools.has(activeTool)}
		<span class="shrink-0">sample <span class="font-mono text-text">5 × 5</span></span>
		<span class="shrink-0">scale <span class="font-mono text-text">1 px : 1 px</span></span>
	{:else if generativeTools.has(activeTool)}
		<!-- TODO(WASM_TODOS.generative): run the provider and composite through the planned binding. -->
		<input
			placeholder="describe an edit"
			class="h-6 min-w-48 rounded border border-subtle bg-surface px-2 placeholder:text-muted/60 focus:border-accent focus:outline-none"
		/>
		<button class="h-6 shrink-0 cursor-pointer rounded bg-text px-2 text-bg">generate</button>
	{:else if activeTool === 'mask-linear' || activeTool === 'mask-radial'}
		<span class="shrink-0">
			drag on the photo to place the {activeTool === 'mask-linear' ? 'linear' : 'radial'} gradient
		</span>
	{:else if activeTool.startsWith('mask')}
		<span class="shrink-0">size <span class="font-mono text-text">{refineBrushSize} px</span></span>
		<span class="shrink-0">feather <span class="font-mono text-text">45%</span></span>
		<span class="shrink-0">flow <span class="font-mono text-text">100%</span></span>
		{#if activeTool === 'mask'}
			<span class="shrink-0"
				>mode <span class="font-mono text-text">{maskBrushOperation}</span></span
			>
		{/if}
	{:else}
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" checked class="size-3 accent-accent" /> auto-select
		</label>
		<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
			<input type="checkbox" class="size-3 accent-accent" /> show transform controls
		</label>
	{/if}
</div>
