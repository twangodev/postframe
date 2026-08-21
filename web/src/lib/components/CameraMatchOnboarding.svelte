<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
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
	const target = $derived(
		candidate?.target === 'camera-jpeg' ? 'camera JPEG' : 'embedded camera preview'
	);
	let selected = $state<MatchGroup[]>([]);
	let expanded = $state<Exclude<MatchGroup, 'curve'> | null>(null);
	let preview = $state<Preview>('match');
	let remember = $state(true);
	let candidateId = $state(0);

	$effect(() => {
		if (!candidate || candidate.id === candidateId) return;
		candidateId = candidate.id;
		selected = ['light', 'color', 'curve'];
		expanded = null;
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

	function show(next: Preview) {
		preview = next;
		workspace.previewNeutralCameraMatch(next === 'neutral');
	}

	function apply(event: SubmitEvent) {
		event.preventDefault();
		workspace.applyCameraMatchCandidate(remember);
	}

	function startNeutral() {
		workspace.startNeutralCameraMatch(remember);
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

{#if candidate}
	<form
		onsubmit={apply}
		aria-labelledby="camera-match-title"
		class="border-b border-accent bg-surface p-3"
	>
		<div>
			<h2 id="camera-match-title" class="text-xs font-medium text-text">match the {target}?</h2>
			<p class="mt-1 text-[10px] leading-relaxed text-muted">
				Postframe translated its rendering into editable controls. Review the starting point before
				keeping it.
			</p>
		</div>

		<div class="mt-3 grid grid-cols-2 rounded border border-subtle p-0.5">
			<button
				type="button"
				aria-pressed={preview === 'neutral'}
				onclick={() => show('neutral')}
				class="cursor-pointer rounded px-2 py-1.5 text-[10px] transition-colors {preview ===
				'neutral'
					? 'bg-elevated text-text'
					: 'text-muted hover:text-text'}"
			>
				neutral RAW
			</button>
			<button
				type="button"
				aria-pressed={preview === 'match'}
				onclick={() => show('match')}
				class="cursor-pointer rounded px-2 py-1.5 text-[10px] transition-colors {preview === 'match'
					? 'bg-elevated text-text'
					: 'text-muted hover:text-text'}"
			>
				camera match
			</button>
		</div>

		<div class="mt-3 space-y-1.5">
			<section class="rounded border border-subtle p-2">
				<div class="flex items-start gap-2">
					<label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
						<input
							type="checkbox"
							checked={selected.includes('light')}
							onchange={(event) => toggle('light', event.currentTarget.checked)}
							class="mt-0.5 accent-accent"
						/>
						<span class="min-w-0">
							<span class="block text-[11px] text-text">light</span>
							<span class="block font-mono text-[9px] leading-relaxed text-muted">
								exposure {signed(candidate.draft.light.exposure, 2)} EV · contrast
								{signed(candidate.draft.light.contrast)}
							</span>
						</span>
					</label>
					<button
						type="button"
						aria-expanded={expanded === 'light'}
						disabled={!selected.includes('light')}
						onclick={() => (expanded = expanded === 'light' ? null : 'light')}
						class="cursor-pointer text-[9px] text-muted hover:text-text disabled:cursor-default disabled:opacity-40"
					>
						tune
					</button>
				</div>
				{#if selected.includes('light') && expanded === 'light'}
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

			<section class="rounded border border-subtle p-2">
				<div class="flex items-start gap-2">
					<label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
						<input
							type="checkbox"
							checked={selected.includes('color')}
							onchange={(event) => toggle('color', event.currentTarget.checked)}
							class="mt-0.5 accent-accent"
						/>
						<span class="min-w-0">
							<span class="block text-[11px] text-text">color</span>
							<span class="block font-mono text-[9px] leading-relaxed text-muted">
								temperature {signed(candidate.draft.color.temperature)} · tint
								{signed(candidate.draft.color.tint)}
							</span>
						</span>
					</label>
					<button
						type="button"
						aria-expanded={expanded === 'color'}
						disabled={!selected.includes('color')}
						onclick={() => (expanded = expanded === 'color' ? null : 'color')}
						class="cursor-pointer text-[9px] text-muted hover:text-text disabled:cursor-default disabled:opacity-40"
					>
						tune
					</button>
				</div>
				{#if selected.includes('color') && expanded === 'color'}
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

			<label class="flex cursor-pointer items-start gap-2 rounded border border-subtle p-2">
				<input
					type="checkbox"
					checked={selected.includes('curve')}
					onchange={(event) => toggle('curve', event.currentTarget.checked)}
					class="mt-0.5 accent-accent"
				/>
				<span class="min-w-0">
					<span class="block text-[11px] text-text">curves</span>
					<span class="block text-[9px] leading-relaxed text-muted">
						{curveSummary(candidate.draft.curve)}
					</span>
				</span>
			</label>
		</div>

		<p class="mt-3 text-[9px] leading-relaxed text-muted">
			This match averages
			<span class="font-mono text-text">{candidate.automatic.meanError.toFixed(2)}/255</span>
			from the {target}. Its fitted camera transform stays paired with these settings so it cannot
			be applied twice.
		</p>

		<label class="mt-3 flex cursor-pointer items-center gap-2 text-[9px] text-muted">
			<input type="checkbox" bind:checked={remember} class="accent-accent" />
			remember this choice for new RAWs
		</label>
		<div class="mt-3 flex gap-2">
			<button type="button" onclick={startNeutral} class={secondaryButtonClass}
				>start neutral</button
			>
			<button type="submit" class={primaryButtonClass}>use camera match</button>
		</div>
	</form>
{/if}
