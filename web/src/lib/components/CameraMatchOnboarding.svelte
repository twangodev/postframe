<script lang="ts">
	import { primaryButtonClass } from '$lib/button';
	import { cameraMatchReviewSummary } from '$lib/camera-match';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const candidate = $derived(workspace.cameraMatchCandidate);
	const target = $derived(
		candidate?.target === 'camera-jpeg' ? 'camera JPEG' : 'embedded camera preview'
	);
	const baselineLabel = $derived(candidate?.firstRun ? 'neutral RAW' : 'current edit');
	const moving = $derived(candidate?.phase === 'targeting' || candidate?.phase === 'moving');
	const reviewSummary = $derived(candidate ? cameraMatchReviewSummary(candidate.affected) : '');
	let remember = $state(true);
	let candidateId = $state(0);

	$effect(() => {
		if (!candidate || candidate.id === candidateId) return;
		candidateId = candidate.id;
		remember = true;
	});

	function apply(event: SubmitEvent) {
		event.preventDefault();
		workspace.applyCameraMatchCandidate(remember);
	}
</script>

{#if candidate}
	<form
		onsubmit={apply}
		aria-labelledby="camera-match-title"
		class="sticky top-0 z-10 border-b border-accent bg-surface/95 p-3 backdrop-blur"
	>
		<h2 id="camera-match-title" class="text-xs font-medium text-text">match the {target}?</h2>
		<p class="mt-1 text-[9px] text-muted">{reviewSummary}</p>

		<div class="mt-2.5">
			<p class="text-[9px] tracking-[0.04em] text-muted">preview</p>
			<div class="mt-0.5 grid grid-cols-2 border-b border-subtle">
				<button
					type="button"
					aria-pressed={candidate.view === 'baseline'}
					onclick={workspace.showCameraMatchBaseline}
					class="-mb-px cursor-pointer border-b px-2 py-1.5 text-[10px] transition-colors {candidate.view ===
					'baseline'
						? 'border-accent text-text'
						: 'border-transparent text-muted hover:text-text'}"
				>
					{baselineLabel}
				</button>
				<button
					type="button"
					aria-pressed={candidate.view === 'match'}
					onclick={workspace.revealCameraMatch}
					class="-mb-px cursor-pointer border-b px-2 py-1.5 text-[10px] transition-colors {candidate.view ===
					'match'
						? 'border-accent text-text'
						: 'border-transparent text-muted hover:text-text'}"
				>
					camera match
				</button>
			</div>
		</div>

		{#if candidate.firstRun}
			<label class="mt-2.5 flex cursor-pointer items-center gap-2 text-[9px] text-muted">
				<input type="checkbox" bind:checked={remember} class="accent-accent" />
				remember this choice for new RAWs
			</label>
		{/if}

		<div class="mt-3 flex flex-col">
			<button
				type="submit"
				disabled={candidate.view !== 'match' || moving}
				class="{primaryButtonClass} w-full disabled:cursor-default disabled:opacity-40"
			>
				use camera match
			</button>
			<button
				type="button"
				onclick={() => workspace.dismissCameraMatchCandidate(remember)}
				class="mt-1.5 w-full cursor-pointer py-1 text-center text-[10px] text-muted transition-colors hover:text-text"
			>
				{candidate.firstRun ? 'start neutral' : 'keep current edit'}
			</button>
		</div>
	</form>
{/if}
