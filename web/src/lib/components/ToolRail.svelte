<script lang="ts">
	import type { Component } from 'svelte';
	import {
		Bandage,
		Blend,
		Brush,
		CircleDashed,
		CircleDot,
		Crop,
		Crosshair,
		Droplets,
		Eraser,
		Eye,
		Fingerprint,
		Frame,
		Hand,
		ImageMinus,
		Lasso,
		ListOrdered,
		Magnet,
		MessageSquare,
		Moon,
		MousePointer,
		Move,
		Paintbrush,
		PaintBucket,
		PenTool,
		Pencil,
		Pipette,
		Redo2,
		RotateCcw,
		Ruler,
		Scan,
		ScanLine,
		ScanSearch,
		Shapes,
		Slice,
		Sparkles,
		Spline,
		SquareDashed,
		Stamp,
		SunMedium,
		Triangle,
		Type,
		Undo2,
		WandSparkles,
		ZoomIn
	} from '@lucide/svelte';
	import SelectableRow from './ui/SelectableRow.svelte';
	import { TOOL_GROUPS, type ToolGroup, type ToolId } from '$lib/editor-tools';

	type Icon = Component<Record<string, unknown>>;

	interface Props {
		activeTool: string;
		onSelect: (id: string) => void;
		canUndo: boolean;
		canRedo: boolean;
		onUndo: () => void;
		onRedo: () => void;
	}

	let { activeTool, onSelect, canUndo, canRedo, onUndo, onRedo }: Props = $props();
	let openGroup = $state<string | null>(null);

	const icons: Record<ToolId, Icon> = {
		move: Move,
		hand: Hand,
		zoom: ZoomIn,
		'rotate-view': RotateCcw,
		'object-select': ScanSearch,
		'quick-select': Brush,
		'magic-wand': WandSparkles,
		marquee: SquareDashed,
		'ellipse-marquee': CircleDashed,
		'single-row-marquee': SquareDashed,
		'single-column-marquee': SquareDashed,
		lasso: Lasso,
		'polygon-lasso': Spline,
		'magnetic-lasso': Magnet,
		crop: Crop,
		'perspective-crop': ScanLine,
		slice: Slice,
		'slice-select': MousePointer,
		frame: Frame,
		remove: Sparkles,
		'spot-heal': Bandage,
		'healing-brush': Pipette,
		patch: Scan,
		'content-aware-move': Move,
		'clone-stamp': Stamp,
		'red-eye': Eye,
		blur: Droplets,
		sharpen: Triangle,
		smudge: Fingerprint,
		dodge: SunMedium,
		burn: Moon,
		sponge: CircleDot,
		'background-eraser': Eraser,
		'magic-eraser': WandSparkles,
		brush: Brush,
		pencil: Pencil,
		'mixer-brush': Paintbrush,
		'color-replacement': Pipette,
		'history-brush': RotateCcw,
		'art-history-brush': Sparkles,
		eraser: Eraser,
		gradient: Blend,
		'paint-bucket': PaintBucket,
		eyedropper: Pipette,
		'color-sampler': Crosshair,
		'pattern-stamp': Stamp,
		pen: PenTool,
		'freeform-pen': Pencil,
		'curvature-pen': Spline,
		'add-anchor': PenTool,
		'delete-anchor': PenTool,
		'convert-point': Spline,
		'path-select': MousePointer,
		type: Type,
		'vertical-type': Type,
		'type-mask': Type,
		shape: Shapes,
		'ellipse-shape': Shapes,
		'triangle-shape': Triangle,
		'polygon-shape': Shapes,
		'star-shape': Sparkles,
		'line-shape': Shapes,
		'custom-shape': Shapes,
		ruler: Ruler,
		note: MessageSquare,
		count: ListOrdered,
		'generative-fill': Sparkles,
		'content-aware-fill': Scan,
		'remove-background': ImageMinus,
		mask: CircleDashed,
		'mask-linear': Blend,
		'mask-radial': CircleDot
	};

	const iconFor = (id: string) => icons[id as ToolId];

	function currentTool(group: ToolGroup) {
		return group.tools.find((tool) => tool.id === activeTool) ?? group.tools[0]!;
	}

	function select(id: string) {
		onSelect(id);
		openGroup = null;
	}
</script>

<aside
	class="motion-panel-left relative z-30 flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-visible border-r border-subtle bg-bg py-2"
>
	{#each TOOL_GROUPS as group (group.id)}
		{@const selected = currentTool(group)}
		{@const SelectedIcon = iconFor(selected.id)}
		<div class="relative">
			<button
				type="button"
				aria-label={`${group.label}: ${selected.label}`}
				aria-haspopup="menu"
				aria-expanded={openGroup === group.id}
				class="group/tool relative flex size-8 cursor-pointer items-center justify-center rounded transition-colors {group.tools.some(
					(tool) => tool.id === activeTool
				)
					? 'bg-surface text-text'
					: 'text-muted hover:bg-surface/60 hover:text-text'}"
				onclick={() => (openGroup = openGroup === group.id ? null : group.id)}
				onkeydown={(event) => event.key === 'Escape' && (openGroup = null)}
			>
				<SelectedIcon size={15} strokeWidth={1.4} />
				<span
					class="absolute right-0.5 bottom-0.5 size-0 border-t-[3px] border-l-[3px] border-muted border-t-transparent border-l-transparent"
				></span>
			</button>

			{#if openGroup === group.id}
				<div
					role="menu"
					aria-label={group.label}
					class="motion-tooltip absolute top-0 left-[calc(100%+0.4rem)] z-50 max-h-[min(34rem,calc(100vh-6rem))] w-52 overflow-y-auto rounded border border-subtle bg-bg p-1.5 shadow-2xl"
				>
					<p class="px-2 pt-1 pb-1.5 text-[11px] tracking-[0.04em] text-muted">{group.label}</p>
					{#each group.tools as tool (tool.id)}
						{#snippet shortcutKey()}
							<kbd class="font-mono text-[10px] opacity-55">{tool.shortcut}</kbd>
						{/snippet}
						<SelectableRow
							role="menuitem"
							selected={activeTool === tool.id}
							icon={iconFor(tool.id)}
							meta={tool.shortcut ? shortcutKey : undefined}
							onclick={() => select(tool.id)}
						>
							{tool.label}
						</SelectableRow>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<div class="my-1 h-px w-5 bg-subtle"></div>
	<button
		type="button"
		aria-label="Undo"
		disabled={!canUndo}
		class="flex size-8 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface/60 hover:text-text disabled:cursor-default disabled:opacity-30"
		onclick={onUndo}
	>
		<Undo2 size={14} strokeWidth={1.4} />
	</button>
	<button
		type="button"
		aria-label="Redo"
		disabled={!canRedo}
		class="flex size-8 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface/60 hover:text-text disabled:cursor-default disabled:opacity-30"
		onclick={onRedo}
	>
		<Redo2 size={14} strokeWidth={1.4} />
	</button>
</aside>
