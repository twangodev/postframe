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
		Plus,
		Scan,
		Trash2,
		UserRound
	} from '@lucide/svelte';
	import SubjectPicker from './SubjectPicker.svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { ColorControlName, LightControlName } from '$lib/develop-settings';
	import type { MaskComponent, NormalizedRegion } from '$lib/edit-document';
	import type { MaskEdgeControlName } from '$lib/mask-edge-settings';
	import { MASK_PREVIEW_MODES, type MaskPreviewMode } from '$lib/mask-preview';
	import type { Mask, MaskKind, SubjectChoices, WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		activeTool: string;
		maskBrushOperation: 'add' | 'subtract';
		maskPreviewMode: MaskPreviewMode | null;
		refineBrushSize: number;
		selectedMask: Mask | null;
		subjectChoices: SubjectChoices | null;
		smartMaskWorking: boolean;
		canRefineSelectedMask: boolean;
		hoveredSubjectBox: NormalizedRegion | null;
		onAddMask: (kind: MaskKind) => void;
		onBeginMaskBrush: (operation: 'add' | 'subtract') => void;
		onBeginObjectMask: () => void;
		onBeginEdgeRefinement: () => void;
	}

	let {
		workspace,
		activeTool,
		maskBrushOperation,
		maskPreviewMode = $bindable(),
		refineBrushSize = $bindable(),
		selectedMask,
		subjectChoices,
		smartMaskWorking,
		canRefineSelectedMask,
		hoveredSubjectBox = $bindable(),
		onAddMask,
		onBeginMaskBrush,
		onBeginObjectMask,
		onBeginEdgeRefinement
	}: Props = $props();

	const previewMaskLight = (control: LightControlName) => (value: number) =>
		workspace.previewMaskLight(control, value);
	const commitMaskLight = (control: LightControlName) => (value: number) =>
		workspace.commitMaskLight(control, value);
	const previewMaskColor = (control: ColorControlName) => (value: number) =>
		workspace.previewMaskColor(control, value);
	const commitMaskColor = (control: ColorControlName) => (value: number) =>
		workspace.commitMaskColor(control, value);
	const previewMaskEdge = (control: MaskEdgeControlName) => (value: number) =>
		workspace.previewMaskEdge(control, value);
	const commitMaskEdge = (control: MaskEdgeControlName) => (value: number) =>
		workspace.commitMaskEdge(control, value);

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
	const chooseMaskPreview = (mode: MaskPreviewMode | null) => () => (maskPreviewMode = mode);
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
				hoveredSubjectBox = null;
				workspace.dismissSubjectChoices();
			}}
			onHover={(box) => (hoveredSubjectBox = box)}
		/>
	{/if}
	<div class="border-subtle border-b p-3">
		<p class="text-muted mb-2 text-[11px] tracking-[0.03em]">new mask</p>
		<div class="grid grid-cols-3 gap-1.5">
			<button type="button" class="mask-choice" onclick={() => onAddMask('brush')}
				><Brush size={15} /><span>brush</span></button
			>
			<button type="button" class="mask-choice" onclick={() => onAddMask('linear')}
				><Blend size={15} /><span>linear</span></button
			>
			<button type="button" class="mask-choice" onclick={() => onAddMask('radial')}
				><CircleDashed size={15} /><span>radial</span></button
			>
			<button type="button" class="mask-choice" onclick={() => onAddMask('subject')}
				><UserRound size={15} /><span>subject</span></button
			>
			<button type="button" class="mask-choice" onclick={() => onAddMask('sky')}
				><CloudSun size={15} /><span>sky</span></button
			>
			<button type="button" class="mask-choice" onclick={() => onAddMask('background')}
				><Mountain size={15} /><span>background</span></button
			>
			<button type="button" class="mask-choice" onclick={onBeginObjectMask}
				><Scan size={15} /><span>object</span></button
			>
		</div>
	</div>

	<div class="border-subtle border-b p-3">
		<div class="mb-2 flex items-center justify-between">
			<p class="text-muted text-[11px] tracking-[0.03em]">layers</p>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label="Choose mask preview"
					class="text-muted hover:bg-surface hover:text-text flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[10px] lowercase outline-none"
				>
					{#if maskPreviewMode}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
					<span>{maskPreviewMode ?? 'off'}</span>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						align="end"
						sideOffset={4}
						class="motion-menu border-subtle bg-bg z-50 min-w-28 rounded border p-1 shadow-2xl"
					>
						{#each MASK_PREVIEW_MODES as mode}
							<DropdownMenu.Item class={previewMenuItemClass} onSelect={chooseMaskPreview(mode)}>
								<span class="text-accent w-3">{maskPreviewMode === mode ? '•' : ''}</span>
								<span>{mode}</span>
							</DropdownMenu.Item>
						{/each}
						<DropdownMenu.Separator class="bg-subtle my-1 h-px" />
						<DropdownMenu.Item class={previewMenuItemClass} onSelect={chooseMaskPreview(null)}>
							<span class="text-accent w-3">{maskPreviewMode === null ? '•' : ''}</span>
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
						: 'hover:bg-surface/65 border-transparent'}"
					onclick={() => workspace.selectMask(mask.id)}
					onkeydown={(event) => event.key === 'Enter' && workspace.selectMask(mask.id)}
				>
					<span class="bg-elevated text-muted flex size-7 items-center justify-center rounded-sm"
						><Scan size={13} /></span
					>
					<span class="min-w-0 flex-1 truncate text-[11px] lowercase">{mask.name}</span>
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
					<p class="text-muted text-[11px]">choose a tool to create a mask.</p>
				</div>
			{/if}
		</div>
	</div>

	{#if selectedMask}
		<Panel title="Mask adjustments" meta={selectedMask.name}>
			{#if candidateComponent?.alternatives && candidateComponent.alternatives.count > 1}
				<div class="border-subtle mb-2 flex h-8 items-center justify-between rounded border px-1">
					<button
						type="button"
						aria-label="Previous mask candidate"
						disabled={smartMaskWorking}
						class="text-muted hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-40"
						onclick={() => cycleMaskCandidate(-1)}
					>
						<ChevronLeft size={12} />
					</button>
					<span class="text-muted text-[10px] lowercase">
						candidate
						<span class="text-text font-mono"
							>{candidateComponent.alternatives.index + 1}/{candidateComponent.alternatives
								.count}</span
						>
					</span>
					<button
						type="button"
						aria-label="Next mask candidate"
						disabled={smartMaskWorking}
						class="text-muted hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-40"
						onclick={() => cycleMaskCandidate(1)}
					>
						<ChevronRight size={12} />
					</button>
				</div>
			{/if}
			<p class="text-muted pb-1 text-[10px] tracking-[0.03em] lowercase">brush</p>
			<div class="grid grid-cols-2 gap-1.5">
				<button
					type="button"
					class="border-subtle text-muted hover:border-muted hover:text-text flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border text-[11px] lowercase transition-colors {activeTool ===
						'mask' && maskBrushOperation === 'add'
						? 'border-accent bg-surface text-text'
						: ''}"
					onclick={() => onBeginMaskBrush('add')}
				>
					<Plus size={12} /> add
				</button>
				<button
					type="button"
					class="border-subtle text-muted hover:border-muted hover:text-text flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border text-[11px] lowercase transition-colors {activeTool ===
						'mask' && maskBrushOperation === 'subtract'
						? 'border-accent bg-surface text-text'
						: ''}"
					onclick={() => onBeginMaskBrush('subtract')}
				>
					<Minus size={12} /> subtract
				</button>
			</div>
			{#if activeTool === 'mask'}
				<div class="motion-enter pt-1">
					<AdjustmentSlider
						label="Brush"
						bind:value={refineBrushSize}
						min={8}
						max={200}
						defaultValue={42}
						suffix=" px"
						signed={false}
					/>
				</div>
			{/if}
			<div class="bg-subtle my-2 h-px"></div>
			<p class="text-muted pb-1 text-[10px] tracking-[0.03em] lowercase">edge</p>
			<AdjustmentSlider
				label="Definition"
				value={selectedMask.edge.contrast}
				min={0}
				max={100}
				signed={false}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskEdge('contrast')}
				onValueCommit={commitMaskEdge('contrast')}
			/>
			<AdjustmentSlider
				label="Feather"
				value={selectedMask.edge.feather}
				min={0}
				max={100}
				suffix=" px"
				signed={false}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskEdge('feather')}
				onValueCommit={commitMaskEdge('feather')}
			/>
			<AdjustmentSlider
				label="Shift"
				value={selectedMask.edge.shift}
				min={-100}
				max={100}
				suffix=" px"
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskEdge('shift')}
				onValueCommit={commitMaskEdge('shift')}
			/>
			<button
				type="button"
				disabled={!canRefineSelectedMask || smartMaskWorking}
				class="border-subtle text-muted hover:border-muted hover:text-text mt-1 flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-[11px] lowercase transition-colors disabled:cursor-default disabled:opacity-40 {activeTool ===
				'mask-refine'
					? 'border-accent bg-surface text-text'
					: ''}"
				onclick={onBeginEdgeRefinement}
			>
				<span class="flex items-center gap-2"><Brush size={12} /> refine edge</span>
				<span>{activeTool === 'mask-refine' ? 'paint boundary' : 'brush'}</span>
			</button>
			{#if activeTool === 'mask-refine'}
				<div class="motion-enter pt-1">
					<AdjustmentSlider
						label="Brush"
						bind:value={refineBrushSize}
						min={8}
						max={200}
						defaultValue={42}
						suffix=" px"
						signed={false}
					/>
				</div>
			{/if}
			<div class="bg-subtle my-2 h-px"></div>
			<p class="text-muted pb-1 text-[10px] tracking-[0.03em] lowercase">light</p>
			<AdjustmentSlider
				label="Exposure"
				value={selectedMask.adjustments.light.exposure}
				min={-4}
				max={4}
				step={0.05}
				decimals={2}
				suffix=" EV"
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('exposure')}
				onValueCommit={commitMaskLight('exposure')}
			/>
			<AdjustmentSlider
				label="Contrast"
				value={selectedMask.adjustments.light.contrast}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('contrast')}
				onValueCommit={commitMaskLight('contrast')}
			/>
			<AdjustmentSlider
				label="Highlights"
				value={selectedMask.adjustments.light.highlights}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('highlights')}
				onValueCommit={commitMaskLight('highlights')}
			/>
			<AdjustmentSlider
				label="Shadows"
				value={selectedMask.adjustments.light.shadows}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('shadows')}
				onValueCommit={commitMaskLight('shadows')}
			/>
			<AdjustmentSlider
				label="Whites"
				value={selectedMask.adjustments.light.whites}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('whites')}
				onValueCommit={commitMaskLight('whites')}
			/>
			<AdjustmentSlider
				label="Blacks"
				value={selectedMask.adjustments.light.blacks}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskLight('blacks')}
				onValueCommit={commitMaskLight('blacks')}
			/>
			<div class="bg-subtle my-2 h-px"></div>
			<p class="text-muted pb-1 text-[10px] tracking-[0.03em] lowercase">color</p>
			<AdjustmentSlider
				label="Temperature"
				value={selectedMask.adjustments.color.temperature}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskColor('temperature')}
				onValueCommit={commitMaskColor('temperature')}
			/>
			<AdjustmentSlider
				label="Tint"
				value={selectedMask.adjustments.color.tint}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskColor('tint')}
				onValueCommit={commitMaskColor('tint')}
			/>
			<AdjustmentSlider
				label="Vibrance"
				value={selectedMask.adjustments.color.vibrance}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskColor('vibrance')}
				onValueCommit={commitMaskColor('vibrance')}
			/>
			<AdjustmentSlider
				label="Saturation"
				value={selectedMask.adjustments.color.saturation}
				min={-100}
				max={100}
				disabled={selectedMask.components.length === 0}
				onValueChange={previewMaskColor('saturation')}
				onValueCommit={commitMaskColor('saturation')}
			/>
		</Panel>
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
