<script lang="ts">
	import { Tabs } from 'bits-ui';
	import {
		Bandage,
		Blend,
		Brush,
		CircleDashed,
		CloudSun,
		Columns2,
		Crop,
		Eye,
		EyeOff,
		History,
		ImageDown,
		Maximize2,
		Minus,
		MousePointer2,
		Mountain,
		Plus,
		Redo2,
		RotateCcw,
		Scan,
		SlidersHorizontal,
		Sparkles,
		Trash2,
		Undo2,
		UserRound
	} from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import type { MaskKind, WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
	let activeTool = $state('pointer');
	let inspectorTab = $state('adjust');
	let zoom = $state(72);
	let before = $state(false);
	let maskOverlay = $state(true);
	let maskAdjustments = $state({ exposure: 0, highlights: 0, shadows: 0, saturation: 0 });

	const active = $derived(workspace.selectedPhoto);
	const selectedMask = $derived(
		workspace.masks.find((mask) => mask.id === workspace.selectedMaskId) ?? null
	);

	function chooseTool(tool: string) {
		activeTool = tool;
		if (tool === 'mask') inspectorTab = 'mask';
	}

	function addMask(kind: MaskKind) {
		workspace.createMask(kind);
		activeTool = 'mask';
		inspectorTab = 'mask';
		maskOverlay = true;
	}
</script>

<div class="bg-canvas flex min-h-0 flex-1 flex-col">
	<div class="flex min-h-0 flex-1">
		<aside
			class="motion-panel-left border-subtle bg-bg flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2"
		>
			<Tooltip text="Select and pan">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Select and pan"
						class="flex size-8 cursor-pointer items-center justify-center rounded transition-colors {activeTool ===
						'pointer'
							? 'bg-surface text-text'
							: 'text-muted hover:bg-surface/60 hover:text-text'}"
						onclick={() => chooseTool('pointer')}
					>
						<MousePointer2 size={15} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>
			<Tooltip text="Crop and rotate">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Crop and rotate"
						class="flex size-8 cursor-pointer items-center justify-center rounded transition-colors {activeTool ===
						'crop'
							? 'bg-surface text-text'
							: 'text-muted hover:bg-surface/60 hover:text-text'}"
						onclick={() => chooseTool('crop')}
					>
						<Crop size={15} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>
			<Tooltip text="Heal and clone">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Heal and clone"
						class="flex size-8 cursor-pointer items-center justify-center rounded transition-colors {activeTool ===
						'heal'
							? 'bg-surface text-text'
							: 'text-muted hover:bg-surface/60 hover:text-text'}"
						onclick={() => chooseTool('heal')}
					>
						<Bandage size={15} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>
			<Tooltip text="Create and edit masks">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Create and edit masks"
						class="flex size-8 cursor-pointer items-center justify-center rounded transition-colors {activeTool ===
						'mask'
							? 'bg-surface text-text'
							: 'text-muted hover:bg-surface/60 hover:text-text'}"
						onclick={() => chooseTool('mask')}
					>
						<CircleDashed size={15} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>

			<div class="bg-subtle my-1 h-px w-5"></div>
			<Tooltip text="Undo">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Undo"
						class="text-muted hover:bg-surface/60 hover:text-text flex size-8 cursor-pointer items-center justify-center rounded"
					>
						<Undo2 size={14} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>
			<Tooltip text="Redo">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						aria-label="Redo"
						class="text-muted hover:bg-surface/60 hover:text-text flex size-8 cursor-pointer items-center justify-center rounded"
					>
						<Redo2 size={14} strokeWidth={1.4} />
					</button>
				{/snippet}
			</Tooltip>
		</aside>

		<section class="motion-panel-up flex min-w-0 flex-1 flex-col">
			<div class="border-subtle bg-bg flex h-9 shrink-0 items-center justify-between border-b px-3">
				<div class="text-muted flex items-center gap-1">
					<Tooltip text="Fit image to view">
						{#snippet children(props)}
							<button
								{...props}
								type="button"
								aria-label="Fit image to view"
								class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
								onclick={() => (zoom = 72)}
							>
								<Maximize2 size={12} />
							</button>
						{/snippet}
					</Tooltip>
					<button
						type="button"
						aria-label="Zoom out"
						class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
						onclick={() => (zoom = Math.max(25, zoom - 10))}
					>
						<Minus size={12} />
					</button>
					<span class="w-9 text-center font-mono text-[10px] tabular-nums">{zoom}%</span>
					<button
						type="button"
						aria-label="Zoom in"
						class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
						onclick={() => (zoom = Math.min(200, zoom + 10))}
					>
						<Plus size={12} />
					</button>
				</div>

				{#if active}
					<p class="text-muted max-w-64 truncate font-mono text-[10px] tracking-wide">
						{active.name}
					</p>
				{/if}

				<button
					type="button"
					class="border-subtle text-muted hover:text-text flex h-6 cursor-pointer items-center gap-1.5 rounded border px-2 text-[10px] transition-colors"
					onclick={() => (before = !before)}
				>
					<Columns2 size={11} />
					{before ? 'before' : 'after'}
				</button>
			</div>

			<div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
				<div
					class="pointer-events-none absolute inset-0 [background-image:radial-gradient(#3c3a34_0.7px,transparent_0.7px)] [background-size:8px_8px] opacity-20"
				></div>
				{#if activeTool === 'crop'}
					<div
						class="motion-enter border-subtle bg-bg absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded border px-2 py-1.5 shadow-lg"
					>
						<span class="text-muted text-[10px]">aspect</span>
						<button
							type="button"
							class="border-subtle bg-surface cursor-pointer rounded border px-2 py-1 text-[10px]"
							>original</button
						>
						<span class="bg-subtle h-4 w-px"></span>
						<RotateCcw size={12} class="text-muted" />
						<span class="text-muted font-mono text-[10px]">0.0°</span>
					</div>
				{:else if activeTool === 'heal'}
					<div
						class="motion-enter border-subtle bg-bg absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded border px-3 py-2 shadow-lg"
					>
						<span class="text-muted text-[10px]">heal</span>
						<span class="text-text text-[10px]">size 42</span>
						<span class="text-text text-[10px]">feather 65</span>
						<span class="text-text text-[10px]">opacity 100</span>
					</div>
				{/if}
				{#if active}
					{#key active.id}
						<div class="motion-photo max-h-full max-w-full">
							<div
								class="relative max-h-full max-w-full overflow-hidden bg-black shadow-2xl transition-transform duration-150"
								style:transform={`scale(${zoom / 72})`}
							>
								<div class="h-[min(64vh,42rem)] w-[min(62vw,62rem)] max-w-full">
									<PhotoVisual photo={active} contain />
								</div>
								{#if before}
									<span
										class="absolute top-3 left-3 rounded-sm bg-black/65 px-2 py-1 text-[10px] tracking-wide text-white backdrop-blur"
									>
										before
									</span>
								{/if}
								{#if activeTool === 'crop'}
									<div
										class="pointer-events-none absolute inset-[8%] border border-white/80 [background-image:linear-gradient(to_right,transparent_33.2%,rgba(255,255,255,0.45)_33.2%,rgba(255,255,255,0.45)_33.5%,transparent_33.5%,transparent_66.4%,rgba(255,255,255,0.45)_66.4%,rgba(255,255,255,0.45)_66.7%,transparent_66.7%),linear-gradient(to_bottom,transparent_33.2%,rgba(255,255,255,0.45)_33.2%,rgba(255,255,255,0.45)_33.5%,transparent_33.5%,transparent_66.4%,rgba(255,255,255,0.45)_66.4%,rgba(255,255,255,0.45)_66.7%,transparent_66.7%)] shadow-[0_0_0_999px_rgba(0,0,0,0.4)]"
									></div>
								{:else if activeTool === 'heal'}
									<div
										class="pointer-events-none absolute top-[46%] left-[58%] size-10 rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
									></div>
								{/if}
								{#if selectedMask?.visible && maskOverlay}
									<div
										class="motion-mask pointer-events-none absolute inset-0 opacity-55 mix-blend-screen {selectedMask.kind ===
										'linear'
											? 'bg-[linear-gradient(135deg,rgba(22,123,255,0.95),transparent_62%)]'
											: selectedMask.kind === 'sky'
												? 'bg-[linear-gradient(to_bottom,rgba(22,123,255,0.95),transparent_52%)]'
												: selectedMask.kind === 'radial' || selectedMask.kind === 'subject'
													? 'bg-[radial-gradient(ellipse_at_center,rgba(22,123,255,0.9)_0%,rgba(22,123,255,0.5)_35%,transparent_68%)]'
													: selectedMask.kind === 'background'
														? 'bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(22,123,255,0.85)_72%)]'
														: 'bg-[radial-gradient(circle_at_58%_46%,rgba(22,123,255,0.9)_0%,rgba(22,123,255,0.55)_12%,transparent_28%)]'}"
									></div>
								{/if}
							</div>
						</div>
					{/key}
				{:else}
					<p class="text-muted text-[10px]">select a photo in organize.</p>
				{/if}
			</div>

			<footer
				class="border-subtle bg-bg text-muted flex h-7 shrink-0 items-center justify-between border-t px-3 text-[10px] tracking-wide"
			>
				<span>display · SDR preview</span>
				<span class="font-mono">{active?.width ?? '—'} × {active?.height ?? '—'} px</span>
			</footer>
		</section>

		<aside
			class="motion-panel-right border-subtle bg-bg w-72 shrink-0 overflow-y-auto border-l max-[1080px]:w-64"
		>
			<Tabs.Root bind:value={inspectorTab}>
				<Tabs.List class="border-subtle bg-bg grid h-10 grid-cols-2 border-b px-2 pt-1">
					<Tabs.Trigger
						value="adjust"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[10px] tracking-[0.03em]"
					>
						adjust
					</Tabs.Trigger>
					<Tabs.Trigger
						value="mask"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[10px] tracking-[0.03em]"
					>
						mask {#if workspace.masks.length > 0}<span class="text-accent ml-1"
								>{workspace.masks.length}</span
							>{/if}
					</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="adjust" class="motion-tab">
					<div class="border-subtle border-b p-3">
						<div
							class="bg-surface flex h-20 items-end gap-px overflow-hidden rounded-sm px-2 pt-3 pb-2"
							aria-label="Histogram preview"
						>
							{#each [18, 25, 31, 38, 52, 67, 79, 63, 86, 94, 71, 59, 47, 73, 61, 44, 34, 28, 20, 13] as height}
								<span class="bg-text/65 flex-1 rounded-t-[1px]" style:height={`${height}%`}></span>
							{/each}
						</div>
						<div class="text-muted mt-2 flex justify-between text-[10px]">
							<span class="font-mono">0</span><span>histogram</span><span class="font-mono"
								>255</span
							>
						</div>
					</div>

					<Panel title="Profile" meta="Camera look">
						<button
							type="button"
							class="border-subtle bg-surface text-text/80 hover:border-muted flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-[11px]"
						>
							<span>camera standard</span><span class="text-muted font-mono text-[10px]">PF</span>
						</button>
					</Panel>

					<Panel title="Light">
						<AdjustmentSlider
							label="Exposure"
							bind:value={workspace.adjustments.exposure}
							min={-4}
							max={4}
							step={0.05}
							decimals={2}
							suffix=" EV"
						/>
						<AdjustmentSlider
							label="Contrast"
							bind:value={workspace.adjustments.contrast}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Highlights"
							bind:value={workspace.adjustments.highlights}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Shadows"
							bind:value={workspace.adjustments.shadows}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Whites"
							bind:value={workspace.adjustments.whites}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Blacks"
							bind:value={workspace.adjustments.blacks}
							min={-100}
							max={100}
						/>
					</Panel>

					<Panel title="Color">
						<AdjustmentSlider
							label="Temperature"
							bind:value={workspace.adjustments.temperature}
							min={2000}
							max={12000}
							step={50}
							suffix="K"
							signed={false}
						/>
						<AdjustmentSlider
							label="Tint"
							bind:value={workspace.adjustments.tint}
							min={-150}
							max={150}
						/>
						<AdjustmentSlider
							label="Vibrance"
							bind:value={workspace.adjustments.vibrance}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Saturation"
							bind:value={workspace.adjustments.saturation}
							min={-100}
							max={100}
						/>
						<button
							type="button"
							class="border-subtle text-muted hover:text-text mt-2 flex w-full cursor-pointer items-center justify-between rounded border px-2 py-2 text-[10px]"
						>
							color mixer <SlidersHorizontal size={12} />
						</button>
					</Panel>

					<Panel title="Presence" open={false}>
						<AdjustmentSlider
							label="Texture"
							bind:value={workspace.adjustments.texture}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Clarity"
							bind:value={workspace.adjustments.clarity}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Dehaze"
							bind:value={workspace.adjustments.dehaze}
							min={-100}
							max={100}
						/>
					</Panel>

					<Panel title="Detail" open={false}>
						<AdjustmentSlider
							label="Sharpening"
							bind:value={workspace.adjustments.sharpening}
							min={0}
							max={100}
							signed={false}
						/>
						<AdjustmentSlider
							label="Noise reduction"
							bind:value={workspace.adjustments.noiseReduction}
							min={0}
							max={100}
							signed={false}
						/>
					</Panel>

					<Panel title="Optics" open={false}>
						<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[10px]">
							<input type="checkbox" checked class="accent-accent" /> remove chromatic aberration
						</label>
						<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[10px]">
							<input type="checkbox" checked class="accent-accent" /> use lens profile
						</label>
					</Panel>

					<Panel title="Presets" open={false}>
						<div class="space-y-1">
							{#each ['Clean color', 'Soft highlight', 'Neutral portrait', 'Cinematic dusk'] as preset}
								<button
									type="button"
									class="text-muted hover:bg-surface hover:text-text flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] lowercase"
								>
									<Sparkles size={11} />
									{preset}
								</button>
							{/each}
						</div>
					</Panel>

					<Panel title="History" open={false} meta={`${workspace.history.length}`}>
						<div class="border-subtle space-y-2 border-l pl-3">
							{#each [...workspace.history].reverse() as item, index}
								<div
									class="flex items-center gap-2 text-[10px] lowercase {index === 0
										? 'text-text'
										: 'text-muted'}"
								>
									<History size={10} />
									{item}
								</div>
							{/each}
						</div>
					</Panel>
				</Tabs.Content>

				<Tabs.Content value="mask" class="motion-tab">
					<div class="border-subtle border-b p-3">
						<p class="text-muted mb-2 text-[10px] tracking-[0.03em]">new mask</p>
						<div class="grid grid-cols-3 gap-1.5">
							<button type="button" class="mask-choice" onclick={() => addMask('brush')}
								><Brush size={15} /><span>brush</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('linear')}
								><Blend size={15} /><span>linear</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('radial')}
								><CircleDashed size={15} /><span>radial</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('subject')}
								><UserRound size={15} /><span>subject</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('sky')}
								><CloudSun size={15} /><span>sky</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('background')}
								><Mountain size={15} /><span>background</span></button
							>
						</div>
					</div>

					<div class="border-subtle border-b p-3">
						<div class="mb-2 flex items-center justify-between">
							<p class="text-muted text-[10px] tracking-[0.03em]">layers</p>
							<button
								type="button"
								class="text-muted hover:text-text cursor-pointer"
								aria-label="Toggle mask overlay"
								onclick={() => (maskOverlay = !maskOverlay)}
							>
								{#if maskOverlay}<Eye size={13} />{:else}<EyeOff size={13} />{/if}
							</button>
						</div>
						<div class="space-y-1">
							{#each workspace.masks as mask (mask.id)}
								<div
									role="button"
									tabindex="0"
									class="group flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-2 text-left {workspace.selectedMaskId ===
									mask.id
										? 'border-accent bg-surface'
										: 'hover:bg-surface/65 border-transparent'}"
									onclick={() => (workspace.selectedMaskId = mask.id)}
									onkeydown={(event) =>
										event.key === 'Enter' && (workspace.selectedMaskId = mask.id)}
								>
									<span
										class="bg-elevated text-muted flex size-7 items-center justify-center rounded-sm"
										><Scan size={13} /></span
									>
									<span class="min-w-0 flex-1 truncate text-[10px] lowercase">{mask.name}</span>
									<button
										type="button"
										aria-label={mask.visible ? 'Hide mask' : 'Show mask'}
										class="text-muted hover:text-text cursor-pointer"
										onclick={(event) => {
											event.stopPropagation();
											workspace.toggleMask(mask.id);
										}}
									>
										{#if mask.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
									</button>
									<button
										type="button"
										aria-label="Delete mask"
										class="text-muted hover:text-negative cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
										onclick={(event) => {
											event.stopPropagation();
											workspace.deleteMask(mask.id);
										}}
									>
										<Trash2 size={12} />
									</button>
								</div>
							{/each}
							{#if workspace.masks.length === 0}
								<div class="border-subtle rounded border border-dashed px-3 py-5 text-center">
									<CircleDashed size={18} strokeWidth={1} class="text-muted mx-auto mb-2" />
									<p class="text-muted text-[10px]">choose a tool to create a mask.</p>
								</div>
							{/if}
						</div>
					</div>

					{#if selectedMask}
						<Panel title="Mask adjustments" meta={selectedMask.name}>
							<AdjustmentSlider
								label="Exposure"
								bind:value={maskAdjustments.exposure}
								min={-4}
								max={4}
								step={0.05}
								decimals={2}
								suffix=" EV"
							/>
							<AdjustmentSlider
								label="Highlights"
								bind:value={maskAdjustments.highlights}
								min={-100}
								max={100}
							/>
							<AdjustmentSlider
								label="Shadows"
								bind:value={maskAdjustments.shadows}
								min={-100}
								max={100}
							/>
							<AdjustmentSlider
								label="Saturation"
								bind:value={maskAdjustments.saturation}
								min={-100}
								max={100}
							/>
						</Panel>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</aside>
	</div>

	<section class="motion-panel-up border-subtle bg-bg flex h-24 shrink-0 border-t">
		<div class="border-subtle text-muted flex w-11 shrink-0 items-center justify-center border-r">
			<ImageDown size={13} strokeWidth={1.25} />
		</div>
		<div class="flex min-w-0 flex-1 gap-2 overflow-x-auto p-2">
			{#each workspace.photos as photo, index (photo.id)}
				<button
					type="button"
					class="motion-card group bg-canvas relative w-24 shrink-0 cursor-pointer overflow-hidden rounded border {workspace.activePhotoId ===
					photo.id
						? 'border-accent'
						: 'border-subtle hover:border-muted'}"
					style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
					onclick={() => workspace.selectPhoto(photo.id)}
				>
					<PhotoVisual {photo} />
					<span
						class="absolute top-1 left-1 rounded-sm bg-black/65 px-1 font-mono text-[10px] text-white"
						>{index + 1}</span
					>
					<span
						class="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 font-mono text-[10px] text-white/80"
						>{photo.name}</span
					>
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	.mask-choice {
		display: flex;
		min-height: 3.5rem;
		cursor: pointer;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid var(--color-subtle);
		border-radius: 0.25rem;
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: 0.625rem;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.mask-choice:hover {
		border-color: var(--color-muted);
		color: var(--color-text);
	}
</style>
