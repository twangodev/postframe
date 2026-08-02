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

	type Icon = Component<Record<string, unknown>>;

	interface Tool {
		id: string;
		label: string;
		shortcut?: string;
		icon: Icon;
	}

	interface ToolGroup {
		id: string;
		label: string;
		tools: Tool[];
	}

	interface Props {
		activeTool: string;
		onSelect: (id: string, label: string) => void;
		canUndo: boolean;
		canRedo: boolean;
		onUndo: () => void;
		onRedo: () => void;
	}

	let { activeTool, onSelect, canUndo, canRedo, onUndo, onRedo }: Props = $props();
	let openGroup = $state<string | null>(null);

	const groups: ToolGroup[] = [
		{
			id: 'view',
			label: 'move & view',
			tools: [
				{ id: 'move', label: 'move', shortcut: 'V', icon: Move },
				{ id: 'hand', label: 'hand', shortcut: 'H', icon: Hand },
				{ id: 'zoom', label: 'zoom', shortcut: 'Z', icon: ZoomIn },
				{ id: 'rotate-view', label: 'rotate view', shortcut: 'R', icon: RotateCcw }
			]
		},
		{
			id: 'select',
			label: 'selection',
			tools: [
				{ id: 'object-select', label: 'object selection', shortcut: 'W', icon: ScanSearch },
				{ id: 'quick-select', label: 'quick selection', shortcut: 'W', icon: Brush },
				{ id: 'magic-wand', label: 'magic wand', shortcut: 'W', icon: WandSparkles },
				{ id: 'marquee', label: 'rectangular marquee', shortcut: 'M', icon: SquareDashed },
				{ id: 'ellipse-marquee', label: 'elliptical marquee', shortcut: 'M', icon: CircleDashed },
				{
					id: 'single-row-marquee',
					label: 'single row marquee',
					shortcut: 'M',
					icon: SquareDashed
				},
				{
					id: 'single-column-marquee',
					label: 'single column marquee',
					shortcut: 'M',
					icon: SquareDashed
				},
				{ id: 'lasso', label: 'lasso', shortcut: 'L', icon: Lasso },
				{ id: 'polygon-lasso', label: 'polygonal lasso', shortcut: 'L', icon: Spline },
				{ id: 'magnetic-lasso', label: 'magnetic lasso', shortcut: 'L', icon: Magnet }
			]
		},
		{
			id: 'crop',
			label: 'crop & frame',
			tools: [
				{ id: 'crop', label: 'crop', shortcut: 'C', icon: Crop },
				{ id: 'perspective-crop', label: 'perspective crop', shortcut: 'C', icon: ScanLine },
				{ id: 'slice', label: 'slice', shortcut: 'C', icon: Slice },
				{ id: 'slice-select', label: 'slice selection', shortcut: 'C', icon: MousePointer },
				{ id: 'frame', label: 'frame', shortcut: 'K', icon: Frame }
			]
		},
		{
			id: 'retouch',
			label: 'retouch',
			tools: [
				{ id: 'remove', label: 'remove', shortcut: 'J', icon: Sparkles },
				{ id: 'spot-heal', label: 'spot healing brush', shortcut: 'J', icon: Bandage },
				{ id: 'healing-brush', label: 'healing brush', shortcut: 'J', icon: Pipette },
				{ id: 'patch', label: 'patch', shortcut: 'J', icon: Scan },
				{ id: 'content-aware-move', label: 'content-aware move', shortcut: 'J', icon: Move },
				{ id: 'clone-stamp', label: 'clone stamp', shortcut: 'S', icon: Stamp },
				{ id: 'red-eye', label: 'red eye', shortcut: 'J', icon: Eye },
				{ id: 'blur', label: 'blur', icon: Droplets },
				{ id: 'sharpen', label: 'sharpen', icon: Triangle },
				{ id: 'smudge', label: 'smudge', icon: Fingerprint },
				{ id: 'dodge', label: 'dodge', shortcut: 'O', icon: SunMedium },
				{ id: 'burn', label: 'burn', shortcut: 'O', icon: Moon },
				{ id: 'sponge', label: 'sponge', shortcut: 'O', icon: CircleDot },
				{ id: 'background-eraser', label: 'background eraser', shortcut: 'E', icon: Eraser },
				{ id: 'magic-eraser', label: 'magic eraser', shortcut: 'E', icon: WandSparkles }
			]
		},
		{
			id: 'paint',
			label: 'paint & fill',
			tools: [
				{ id: 'brush', label: 'brush', shortcut: 'B', icon: Brush },
				{ id: 'pencil', label: 'pencil', shortcut: 'B', icon: Pencil },
				{ id: 'mixer-brush', label: 'mixer brush', shortcut: 'B', icon: Paintbrush },
				{ id: 'color-replacement', label: 'color replacement', shortcut: 'B', icon: Pipette },
				{ id: 'history-brush', label: 'history brush', shortcut: 'Y', icon: RotateCcw },
				{ id: 'art-history-brush', label: 'art history brush', shortcut: 'Y', icon: Sparkles },
				{ id: 'eraser', label: 'eraser', shortcut: 'E', icon: Eraser },
				{ id: 'gradient', label: 'gradient', shortcut: 'G', icon: Blend },
				{ id: 'paint-bucket', label: 'paint bucket', shortcut: 'G', icon: PaintBucket },
				{ id: 'eyedropper', label: 'eyedropper', shortcut: 'I', icon: Pipette },
				{ id: 'color-sampler', label: 'color sampler', shortcut: 'I', icon: Crosshair },
				{ id: 'pattern-stamp', label: 'pattern stamp', shortcut: 'S', icon: Stamp }
			]
		},
		{
			id: 'draw',
			label: 'type & vector',
			tools: [
				{ id: 'pen', label: 'pen', shortcut: 'P', icon: PenTool },
				{ id: 'freeform-pen', label: 'freeform pen', shortcut: 'P', icon: Pencil },
				{ id: 'curvature-pen', label: 'curvature pen', shortcut: 'P', icon: Spline },
				{ id: 'add-anchor', label: 'add anchor point', icon: PenTool },
				{ id: 'delete-anchor', label: 'delete anchor point', icon: PenTool },
				{ id: 'convert-point', label: 'convert point', icon: Spline },
				{ id: 'path-select', label: 'path selection', shortcut: 'A', icon: MousePointer },
				{ id: 'type', label: 'horizontal type', shortcut: 'T', icon: Type },
				{ id: 'vertical-type', label: 'vertical type', shortcut: 'T', icon: Type },
				{ id: 'type-mask', label: 'type mask', shortcut: 'T', icon: Type },
				{ id: 'shape', label: 'rectangle', shortcut: 'U', icon: Shapes },
				{ id: 'ellipse-shape', label: 'ellipse', shortcut: 'U', icon: Shapes },
				{ id: 'triangle-shape', label: 'triangle', shortcut: 'U', icon: Triangle },
				{ id: 'polygon-shape', label: 'polygon', shortcut: 'U', icon: Shapes },
				{ id: 'star-shape', label: 'star', shortcut: 'U', icon: Sparkles },
				{ id: 'line-shape', label: 'line', shortcut: 'U', icon: Shapes },
				{ id: 'custom-shape', label: 'custom shape', shortcut: 'U', icon: Shapes }
			]
		},
		{
			id: 'measure',
			label: 'measure',
			tools: [
				{ id: 'ruler', label: 'ruler', shortcut: 'I', icon: Ruler },
				{ id: 'note', label: 'note', icon: MessageSquare },
				{ id: 'count', label: 'count', icon: ListOrdered }
			]
		},
		{
			id: 'generate',
			label: 'generative',
			tools: [
				{ id: 'generative-fill', label: 'generative fill', icon: Sparkles },
				{ id: 'content-aware-fill', label: 'content-aware fill', icon: Scan },
				{ id: 'remove-background', label: 'remove background', icon: ImageMinus }
			]
		},
		{
			id: 'mask',
			label: 'masking',
			tools: [
				{ id: 'mask', label: 'mask brush', shortcut: 'Q', icon: CircleDashed },
				{ id: 'mask-linear', label: 'linear mask', icon: Blend },
				{ id: 'mask-radial', label: 'radial mask', icon: CircleDot }
			]
		}
	];

	function currentTool(group: ToolGroup) {
		return group.tools.find((tool) => tool.id === activeTool) ?? group.tools[0];
	}

	function select(tool: Tool) {
		onSelect(tool.id, tool.label);
		openGroup = null;
	}
</script>

<aside
	class="motion-panel-left border-subtle bg-bg relative z-30 flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-visible border-r py-2"
>
	{#each groups as group (group.id)}
		{@const selected = currentTool(group)}
		{@const SelectedIcon = selected.icon}
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
					class="border-muted absolute right-0.5 bottom-0.5 size-0 border-t-[3px] border-l-[3px] border-t-transparent border-l-transparent"
				></span>
			</button>

			{#if openGroup === group.id}
				<div
					role="menu"
					aria-label={group.label}
					class="motion-tooltip border-subtle bg-bg absolute top-0 left-[calc(100%+0.4rem)] z-50 max-h-[min(34rem,calc(100vh-6rem))] w-52 overflow-y-auto rounded border p-1.5 shadow-2xl"
				>
					<p class="text-muted px-2 pt-1 pb-1.5 text-[10px] tracking-[0.04em]">{group.label}</p>
					{#each group.tools as tool (tool.id)}
						{@const ToolIcon = tool.icon}
						<button
							type="button"
							role="menuitem"
							class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] transition-colors {activeTool ===
							tool.id
								? 'bg-surface text-text'
								: 'text-muted hover:bg-surface/60 hover:text-text'}"
							onclick={() => select(tool)}
						>
							<ToolIcon size={13} strokeWidth={1.4} />
							<span class="flex-1">{tool.label}</span>
							{#if tool.shortcut}
								<kbd class="font-mono text-[9px] opacity-55">{tool.shortcut}</kbd>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<div class="bg-subtle my-1 h-px w-5"></div>
	<button
		type="button"
		aria-label="Undo"
		disabled={!canUndo}
		class="text-muted hover:bg-surface/60 hover:text-text flex size-8 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-30"
		onclick={onUndo}
	>
		<Undo2 size={14} strokeWidth={1.4} />
	</button>
	<button
		type="button"
		aria-label="Redo"
		disabled={!canRedo}
		class="text-muted hover:bg-surface/60 hover:text-text flex size-8 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-30"
		onclick={onRedo}
	>
		<Redo2 size={14} strokeWidth={1.4} />
	</button>
</aside>
