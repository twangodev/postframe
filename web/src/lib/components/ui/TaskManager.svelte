<script lang="ts">
	import type { BackgroundTask } from '$lib/progress-task';
	import ProgressCard from './ProgressCard.svelte';

	interface Props {
		tasks: BackgroundTask[];
		cancel?: { key: string; run: () => void };
	}

	let { tasks, cancel }: Props = $props();
	let expanded = $state(false);

	const summary = $derived(
		tasks.length === 1
			? { ...tasks[0].task, label: tasks[0].name }
			: { label: `${tasks.length} jobs running`, detail: null, progress: null, error: null }
	);
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (expanded = false)} />

{#if tasks.length > 0}
	<div
		class="pointer-events-none fixed right-3 bottom-3 z-50 hidden flex-col items-end gap-2 min-[900px]:flex"
	>
		{#if expanded}
			<div
				class="border-subtle bg-bg/95 pointer-events-auto flex w-72 flex-col gap-2 rounded border p-2 shadow-xl backdrop-blur"
			>
				{#each tasks as entry (entry.key)}
					<div>
						<p class="text-muted mb-1 text-[9px] tracking-[0.03em]">{entry.name}</p>
						<ProgressCard
							task={entry.task}
							variant="inline"
							onCancel={cancel?.key === entry.key ? cancel.run : undefined}
						/>
					</div>
				{/each}
			</div>
		{/if}
		<button
			type="button"
			class="pointer-events-auto w-56 cursor-pointer text-left"
			aria-expanded={expanded}
			aria-label="Background tasks"
			onclick={() => (expanded = !expanded)}
		>
			<ProgressCard task={summary} variant="inline" />
		</button>
	</div>
{/if}
