<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { primaryButtonClass, secondaryButtonClass } from '$lib/button';
	import { defaultDevelopSettings } from '$lib/develop-settings';
	import type { CameraMatchResult } from '$lib/camera-match';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	type MatchGroup = 'light' | 'color' | 'curve';
	type Preview = 'neutral' | 'match';

	const candidate = $derived(workspace.cameraMatchCandidate);
	let selected = $state<MatchGroup[]>([]);
	let preview = $state<Preview>('match');
	let remember = $state(true);
	let candidateId = $state(0);

	$effect(() => {
		if (!candidate || candidate.id === candidateId) return;
		candidateId = candidate.id;
		selected = ['light', 'color', 'curve'];
		preview = 'match';
		remember = true;
	});

	function update(result: CameraMatchResult) {
		preview = 'match';
		workspace.previewCameraMatch(result);
	}

	function toggle(group: MatchGroup, checked: boolean) {
		if (!candidate) return;
		selected = checked
			? [...selected.filter((value) => value !== group), group]
			: selected.filter((value) => value !== group);
		const neutral = defaultDevelopSettings();
		update({
			...candidate.draft,
			[group]: checked ? candidate.automatic[group] : neutral[group]
		});
	}

	function updateLight(control: 'exposure' | 'contrast', value: number) {
		if (!candidate) return;
		update({
			...candidate.draft,
			light: { ...candidate.draft.light, [control]: value }
		});
	}

	function updateColor(control: 'temperature' | 'tint', value: number) {
		if (!candidate) return;
		update({
			...candidate.draft,
			color: { ...candidate.draft.color, [control]: value }
		});
	}

	function updateCameraLook(value: number) {
		if (!candidate) return;
		update({ ...candidate.draft, cameraLook: value });
	}

	function show(next: Preview) {
		preview = next;
		workspace.previewNeutralCameraMatch(next === 'neutral');
	}

	function apply(event: SubmitEvent) {
		event.preventDefault();
		workspace.applyCameraMatchCandidate(remember);
	}

	function startNeutral() {
		workspace.startNeutralCameraMatch(true);
	}

	function openChanged(open: boolean) {
		if (!open && workspace.cameraMatchPromptOpen) workspace.cancelCameraMatchCandidate();
	}

	const signed = (value: number, digits = 0) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
	const shaped = (points: readonly { x: number; y: number }[]) =>
		points.length > 2 || points.some(({ x, y }) => Math.abs(x - y) > 0.001);
	const curveSummary = (curve: CameraMatchResult['curve']) =>
		(
			[
				['red', curve.red],
				['green', curve.green],
				['blue', curve.blue]
			] as const
		)
			.filter(([, points]) => shaped(points))
			.map(([name]) => `${name} shaped`)
			.join(' · ') || 'neutral';
</script>

<DialogShell
	open={workspace.cameraMatchPromptOpen}
	onOpenChange={openChanged}
	size="lg"
	class="p-5"
	overlayClass="bg-black/30 backdrop-blur-[1px]"
>
	<form onsubmit={apply}>
		<DialogHeader
			title="start from the camera rendering?"
			description={candidate?.target === 'camera-jpeg'
				? 'Postframe can turn the companion camera JPEG into ordinary, editable settings.'
				: 'Postframe can turn the RAW’s embedded camera preview into ordinary, editable settings.'}
		/>

		{#if candidate}
			<div class="mt-4 grid grid-cols-2 rounded border border-subtle p-0.5">
				<button
					type="button"
					aria-pressed={preview === 'neutral'}
					onclick={() => show('neutral')}
					class="cursor-pointer rounded px-3 py-1.5 text-[11px] transition-colors {preview ===
					'neutral'
						? 'bg-surface text-text'
						: 'text-muted hover:text-text'}"
				>
					neutral RAW
				</button>
				<button
					type="button"
					aria-pressed={preview === 'match'}
					onclick={() => show('match')}
					class="cursor-pointer rounded px-3 py-1.5 text-[11px] transition-colors {preview ===
					'match'
						? 'bg-surface text-text'
						: 'text-muted hover:text-text'}"
				>
					proposed match
				</button>
			</div>

			<p class="mt-3 text-[11px] leading-relaxed text-muted">
				This is a starting point, not a baked preset. Fine-tune it now or continue editing every
				setting after you apply it.
			</p>

			<div class="mt-4 space-y-2">
				<section class="rounded border border-subtle p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							checked={selected.includes('light')}
							onchange={(event) => toggle('light', event.currentTarget.checked)}
							class="mt-0.5 accent-accent"
						/>
						<span>
							<span class="block text-xs text-text">light</span>
							<span class="font-mono text-[10px] text-muted">
								exposure {signed(candidate.draft.light.exposure, 2)} EV · contrast
								{signed(candidate.draft.light.contrast)}
							</span>
						</span>
					</label>
					{#if selected.includes('light')}
						<div class="mt-2 border-t border-subtle pt-2">
							<AdjustmentSlider
								label="Exposure"
								value={candidate.draft.light.exposure}
								defaultValue={candidate.automatic.light.exposure}
								min={-4}
								max={4}
								step={0.05}
								decimals={2}
								suffix=" EV"
								onValueChange={(value) => updateLight('exposure', value)}
							/>
							<AdjustmentSlider
								label="Contrast"
								value={candidate.draft.light.contrast}
								defaultValue={candidate.automatic.light.contrast}
								min={-100}
								max={100}
								onValueChange={(value) => updateLight('contrast', value)}
							/>
						</div>
					{/if}
				</section>

				<section class="rounded border border-subtle p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							checked={selected.includes('color')}
							onchange={(event) => toggle('color', event.currentTarget.checked)}
							class="mt-0.5 accent-accent"
						/>
						<span>
							<span class="block text-xs text-text">color</span>
							<span class="font-mono text-[10px] text-muted">
								temperature {signed(candidate.draft.color.temperature)} · tint
								{signed(candidate.draft.color.tint)}
							</span>
						</span>
					</label>
					{#if selected.includes('color')}
						<div class="mt-2 border-t border-subtle pt-2">
							<AdjustmentSlider
								label="Temperature"
								value={candidate.draft.color.temperature}
								defaultValue={candidate.automatic.color.temperature}
								min={-100}
								max={100}
								onValueChange={(value) => updateColor('temperature', value)}
							/>
							<AdjustmentSlider
								label="Tint"
								value={candidate.draft.color.tint}
								defaultValue={candidate.automatic.color.tint}
								min={-100}
								max={100}
								onValueChange={(value) => updateColor('tint', value)}
							/>
						</div>
					{/if}
				</section>

				<label class="flex cursor-pointer items-start gap-3 rounded border border-subtle p-3">
					<input
						type="checkbox"
						checked={selected.includes('curve')}
						onchange={(event) => toggle('curve', event.currentTarget.checked)}
						class="mt-0.5 accent-accent"
					/>
					<span>
						<span class="block text-xs text-text">curves</span>
						<span class="text-[10px] text-muted">{curveSummary(candidate.draft.curve)}</span>
					</span>
				</label>

				<section class="rounded border border-subtle p-3">
					<div class="mb-1 flex items-baseline justify-between">
						<span class="text-xs text-text">remaining camera look</span>
						<span class="font-mono text-[10px] text-muted"
							>{Math.round(candidate.draft.cameraLook)}%</span
						>
					</div>
					<AdjustmentSlider
						label="Camera look"
						value={candidate.draft.cameraLook}
						defaultValue={candidate.automatic.cameraLook}
						min={0}
						max={100}
						signed={false}
						suffix="%"
						onValueChange={updateCameraLook}
					/>
				</section>
			</div>

			<p class="mt-3 text-[10px] leading-relaxed text-muted">
				The automatic starting point matches the camera rendering to within
				<span class="font-mono text-text">{candidate.automatic.meanError.toFixed(2)}/255</span>
				on average.
			</p>

			<div class="mt-5 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
				<button type="button" onclick={startNeutral} class={secondaryButtonClass}>
					always start neutral
				</button>
				<label class="ml-auto flex cursor-pointer items-center gap-2 text-[10px] text-muted">
					<input type="checkbox" bind:checked={remember} class="accent-accent" />
					automatically match future RAWs
				</label>
				<button type="submit" class={primaryButtonClass}>use this match</button>
			</div>
		{/if}
	</form>
</DialogShell>
