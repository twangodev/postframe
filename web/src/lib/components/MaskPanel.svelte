<script lang="ts">
	import { DropdownMenu, Tabs } from 'bits-ui';
	import {
		Blend,
		Brush,
		ChevronLeft,
		ChevronRight,
		CircleDashed,
		CloudSun,
		Eye,
		EyeOff,
		Minus,
		Mountain,
		Palette,
		Plus,
		Scan,
		SunMedium,
		Trash2,
		UserRound
	} from '@lucide/svelte';
	import ColorMixerSection from './ColorMixerSection.svelte';
	import GradingSection from './GradingSection.svelte';
	import SubjectPicker from './SubjectPicker.svelte';
	import ToneCurveSection from './ToneCurveSection.svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import IconButton from './ui/IconButton.svelte';
	import Panel from './ui/Panel.svelte';
	import { COLOR_SLIDERS, LIGHT_SLIDERS, MASK_EDGE_SLIDERS } from '$lib/develop-sliders';
	import { maskOperationSchema, type MaskComponent, type MaskOperation } from '$lib/edit-document';
	import type { EditorToolSession } from '$lib/editor-tool-session.svelte';
	import {
		rangeComponents,
		rangeSliderSpecs,
		rangeSliderValue,
		withRangeControl,
		type RangeKind
	} from '$lib/mask-ranging';
	import { MASK_PREVIEW_MODES, type MaskPreviewMode } from '$lib/mask-preview';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		tools: EditorToolSession;
	}

	let { workspace, tools }: Props = $props();

	const activeTool = $derived(tools.tool);
	const selectedMask = $derived(tools.selectedMask);
	const subjectChoices = $derived(tools.subjectChoices);
	const smartMaskWorking = $derived(tools.smartMaskWorking);
	const maskEmpty = $derived((selectedMask?.components.length ?? 0) === 0);

	let rangeOperation = $state<MaskOperation>('add');
	const selectedRanges = $derived(rangeComponents(selectedMask));
	const addRange = (kind: RangeKind) => () =>
		void workspace.addRangeComponent(kind, rangeOperation);

	const candidateComponent = $derived(
		selectedMask?.components.find(
			(component): component is Extract<MaskComponent, { type: 'ai-object' | 'ai-instance' }> =>
				component.type === 'ai-object' || component.type === 'ai-instance'
		) ?? null
	);
	const cycleMaskCandidate = $derived(
		candidateComponent?.type === 'ai-instance'
			? workspace.cycleInstanceMaskCandidate
			: workspace.cycleObjectMaskCandidate
	);
	const previewMenuItemClass =
		'data-[highlighted]:bg-elevated data-[highlighted]:text-text flex h-7 min-w-32 cursor-default items-center rounded-sm px-2 text-[11px] outline-none';
	const chooseMaskPreview = (mode: MaskPreviewMode | null) => () => (tools.maskPreviewMode = mode);
</script>

<Tabs.Content value="mask" class="motion-tab">
	{#if subjectChoices && workspace.editPreview}
		<SubjectPicker
			subjects={subjectChoices.subjects}
			created={subjectChoices.created}
			previewSrc={workspace.editPreview.src}
			busy={smartMaskWorking}
			onChoose={(index) => void workspace.chooseDetectedSubject(index)}
			onChooseAll={workspace.chooseAllSubjects}
			onDismiss={() => {
				tools.hoveredSubjectBox = null;
				workspace.dismissSubjectChoices();
			}}
			onHover={(box) => (tools.hoveredSubjectBox = box)}
		/>
	{/if}
	<div class="border-b border-subtle p-3">
		<p class="mb-2 text-[11px] tracking-[0.03em] text-muted">new mask</p>
		<div class="grid grid-cols-3 gap-1.5">
			<button type="button" class="mask-choice" onclick={() => tools.addMask('brush')}
				><Brush size={15} /><span>brush</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('linear')}
				><Blend size={15} /><span>linear</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('radial')}
				><CircleDashed size={15} /><span>radial</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('subject')}
				><UserRound size={15} /><span>subject</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('sky')}
				><CloudSun size={15} /><span>sky</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('background')}
				><Mountain size={15} /><span>background</span></button
			>
			<button type="button" class="mask-choice" onclick={tools.beginObjectMask}
				><Scan size={15} /><span>object</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('luminance')}
				><SunMedium size={15} /><span>luminance</span></button
			>
			<button type="button" class="mask-choice" onclick={() => tools.addMask('color')}
				><Palette size={15} /><span>colour</span></button
			>
		</div>
	</div>

	<div class="border-b border-subtle p-3">
		<div class="mb-2 flex items-center justify-between">
			<p class="text-[11px] tracking-[0.03em] text-muted">layers</p>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label="Choose mask preview"
					class="flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[10px] text-muted lowercase outline-none hover:bg-surface hover:text-text"
				>
					{#if tools.maskPreviewMode}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
					<span>{tools.maskPreviewMode ?? 'off'}</span>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						align="end"
						sideOffset={4}
						class="motion-menu z-50 min-w-28 rounded border border-subtle bg-bg p-1 shadow-2xl"
					>
						{#each MASK_PREVIEW_MODES as mode (mode)}
							<DropdownMenu.Item class={previewMenuItemClass} onSelect={chooseMaskPreview(mode)}>
								<span class="w-3 text-accent">{tools.maskPreviewMode === mode ? '•' : ''}</span>
								<span>{mode}</span>
							</DropdownMenu.Item>
						{/each}
						<DropdownMenu.Separator class="my-1 h-px bg-subtle" />
						<DropdownMenu.Item class={previewMenuItemClass} onSelect={chooseMaskPreview(null)}>
							<span class="w-3 text-accent">{tools.maskPreviewMode === null ? '•' : ''}</span>
							<span>off</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
		<div class="space-y-1">
			{#each workspace.masks as mask (mask.id)}
				<div
					role="button"
					tabindex="0"
					class="group flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-2 text-left {workspace.selectedMaskId ===
					mask.id
						? 'border-accent bg-surface'
						: 'border-transparent hover:bg-surface/65'}"
					onclick={() => workspace.selectMask(mask.id)}
					onkeydown={(event) => event.key === 'Enter' && workspace.selectMask(mask.id)}
				>
					<span class="flex size-7 items-center justify-center rounded-sm bg-elevated text-muted"
						><Scan size={13} /></span
					>
					<span class="min-w-0 flex-1 truncate text-[11px] lowercase">{mask.name}</span>
					<button
						type="button"
						aria-label={mask.visible ? 'Hide mask' : 'Show mask'}
						class="cursor-pointer text-muted hover:text-text"
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
						class="cursor-pointer text-muted opacity-0 group-hover:opacity-100 hover:text-negative focus:opacity-100"
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
				<div class="rounded border border-dashed border-subtle px-3 py-5 text-center">
					<CircleDashed size={18} strokeWidth={1} class="mx-auto mb-2 text-muted" />
					<p class="text-[11px] text-muted">choose a tool to create a mask.</p>
				</div>
			{/if}
		</div>
	</div>

	{#if selectedMask}
		<Panel title="Mask adjustments" meta={selectedMask.name}>
			{#if candidateComponent?.alternatives && candidateComponent.alternatives.count > 1}
				<div class="mb-2 flex h-8 items-center justify-between rounded border border-subtle px-1">
					<IconButton
						label="Previous mask candidate"
						disabled={smartMaskWorking}
						onclick={() => cycleMaskCandidate(-1)}
					>
						<ChevronLeft size={12} />
					</IconButton>
					<span class="text-[10px] text-muted lowercase">
						candidate
						<span class="font-mono text-text"
							>{candidateComponent.alternatives.index + 1}/{candidateComponent.alternatives
								.count}</span
						>
					</span>
					<IconButton
						label="Next mask candidate"
						disabled={smartMaskWorking}
						onclick={() => cycleMaskCandidate(1)}
					>
						<ChevronRight size={12} />
					</IconButton>
				</div>
			{/if}
			<p class="pb-1 text-[10px] tracking-[0.03em] text-muted lowercase">brush</p>
			<div class="grid grid-cols-2 gap-1.5">
				<button
					type="button"
					class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:border-muted hover:text-text {activeTool ===
						'mask' && tools.maskBrushOperation === 'add'
						? 'border-accent bg-surface text-text'
						: ''}"
					onclick={() => tools.beginMaskBrush('add')}
				>
					<Plus size={12} /> add
				</button>
				<button
					type="button"
					class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:border-muted hover:text-text {activeTool ===
						'mask' && tools.maskBrushOperation === 'subtract'
						? 'border-accent bg-surface text-text'
						: ''}"
					onclick={() => tools.beginMaskBrush('subtract')}
				>
					<Minus size={12} /> subtract
				</button>
			</div>
			{#if activeTool === 'mask'}
				<div class="motion-enter pt-1">
					<AdjustmentSlider
						label="Brush"
						bind:value={tools.refineBrushSize}
						min={8}
						max={200}
						defaultValue={42}
						suffix=" px"
						signed={false}
					/>
				</div>
			{/if}
			<div class="my-2 h-px bg-subtle"></div>
			<p class="pb-1 text-[10px] tracking-[0.03em] text-muted lowercase">range</p>
			{#each selectedRanges as component (component.id)}
				<div
					role="group"
					aria-label={component.type === 'luminance-range' ? 'luminance range' : 'colour range'}
					class="mb-1.5 rounded border border-subtle px-2 pt-1.5 pb-0.5"
				>
					<p class="text-[10px] text-muted lowercase">
						{component.type === 'luminance-range' ? 'luminance' : 'colour'} · {component.operation}
					</p>
					{#each rangeSliderSpecs(component) as spec (spec.control)}
						<AdjustmentSlider
							{...spec}
							value={rangeSliderValue(component, spec)}
							onValueChange={(value) =>
								workspace.previewRange(
									component.id,
									withRangeControl(component, spec.control, value)
								)}
							onValueCommit={(value) =>
								void workspace.commitRange(
									component.id,
									withRangeControl(component, spec.control, value)
								)}
						/>
					{/each}
				</div>
			{/each}
			<div class="mb-1.5 flex gap-1" role="tablist" aria-label="Range operation">
				{#each maskOperationSchema.options as operation (operation)}
					<button
						type="button"
						role="tab"
						aria-selected={rangeOperation === operation}
						onclick={() => (rangeOperation = operation)}
						class="h-6 flex-1 cursor-pointer rounded border text-[11px] lowercase transition-colors {rangeOperation ===
						operation
							? 'border-control-edge bg-surface text-text'
							: 'border-subtle text-muted hover:text-text'}"
					>
						{operation}
					</button>
				{/each}
			</div>
			<div class="grid grid-cols-2 gap-1.5">
				<button
					type="button"
					class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:border-muted hover:text-text"
					onclick={addRange('luminance')}
				>
					<Plus size={12} /> luminance range
				</button>
				<button
					type="button"
					class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:border-muted hover:text-text"
					onclick={addRange('color')}
				>
					<Plus size={12} /> colour range
				</button>
			</div>
			<div class="my-2 h-px bg-subtle"></div>
			<p class="pb-1 text-[10px] tracking-[0.03em] text-muted lowercase">edge</p>
			<AdjustmentSliders
				sliders={MASK_EDGE_SLIDERS}
				values={selectedMask.edge}
				disabled={maskEmpty}
				onPreview={workspace.previewMaskEdge}
				onCommit={workspace.commitMaskEdge}
			/>
			<button
				type="button"
				disabled={!tools.canRefineSelectedMask || smartMaskWorking}
				class="mt-1 flex h-8 w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 text-[11px] text-muted lowercase transition-colors hover:border-muted hover:text-text disabled:cursor-default disabled:opacity-40 {activeTool ===
				'mask-refine'
					? 'border-accent bg-surface text-text'
					: ''}"
				onclick={tools.beginEdgeRefinement}
			>
				<span class="flex items-center gap-2"><Brush size={12} /> refine edge</span>
				<span>{activeTool === 'mask-refine' ? 'paint boundary' : 'brush'}</span>
			</button>
			{#if activeTool === 'mask-refine'}
				<div class="motion-enter pt-1">
					<AdjustmentSlider
						label="Brush"
						bind:value={tools.refineBrushSize}
						min={8}
						max={200}
						defaultValue={42}
						suffix=" px"
						signed={false}
					/>
				</div>
			{/if}
			<div class="my-2 h-px bg-subtle"></div>
			<p class="pb-1 text-[10px] tracking-[0.03em] text-muted lowercase">light</p>
			<AdjustmentSliders
				sliders={LIGHT_SLIDERS}
				values={selectedMask.adjustments.light}
				disabled={maskEmpty}
				onPreview={(control, value) =>
					workspace.previewMaskAdjustmentAt({ group: 'light', control }, value)}
				onCommit={(control, value) =>
					workspace.commitMaskAdjustmentAt({ group: 'light', control }, value)}
			/>
			<div class="my-2 h-px bg-subtle"></div>
			<p class="pb-1 text-[10px] tracking-[0.03em] text-muted lowercase">color</p>
			<AdjustmentSliders
				sliders={COLOR_SLIDERS}
				values={selectedMask.adjustments.color}
				disabled={maskEmpty}
				onPreview={(control, value) =>
					workspace.previewMaskAdjustmentAt({ group: 'color', control }, value)}
				onCommit={(control, value) =>
					workspace.commitMaskAdjustmentAt({ group: 'color', control }, value)}
			/>
		</Panel>
		{#if workspace.selectedMaskDevelop}
			{@const binding = workspace.selectedMaskDevelop}
			<ToneCurveSection {binding} />
			<ColorMixerSection {binding} />
			<GradingSection {binding} />
		{/if}
	{/if}
</Tabs.Content>

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
		font-size: 0.6875rem;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.mask-choice:hover {
		border-color: var(--color-muted);
		color: var(--color-text);
	}
</style>
