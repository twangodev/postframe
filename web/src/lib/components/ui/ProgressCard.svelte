<script lang="ts">
	import type { ProgressTask } from '$lib/progress-task';

	interface Props {
		task: ProgressTask;
		variant: 'floating' | 'inline';
		onCancel?: () => void;
	}

	let { task, variant, onCancel }: Props = $props();
</script>

<div
	class={variant === 'floating'
		? 'motion-enter pointer-events-auto w-full max-w-72 rounded border border-white/10 bg-black/70 px-3 py-2.5 text-white shadow-xl backdrop-blur-md'
		: 'overflow-hidden rounded border border-subtle bg-surface px-2 py-1.5'}
>
	<div class="flex min-w-0 items-center gap-2">
		<p
			class={[
				'min-w-0 flex-1 truncate',
				variant === 'floating' ? 'text-[11px]' : 'text-[10px]',
				task.error ? 'text-negative' : variant === 'inline' && 'text-muted'
			]}
		>
			{task.error ?? task.label}
			{#if !task.error && task.detail}
				<span class="font-mono text-[10px] tabular-nums opacity-40">· {task.detail}</span>
			{/if}
		</p>
		{#if onCancel}
			<button
				type="button"
				class="cursor-pointer text-[10px] opacity-40 transition-opacity hover:opacity-100"
				onclick={onCancel}
			>
				cancel
			</button>
		{/if}
	</div>
	{#if !task.error}
		<div
			class={[
				'relative overflow-hidden',
				variant === 'floating' ? 'mt-2 h-0.5 rounded-full bg-white/10' : 'mt-1 h-px bg-subtle'
			]}
		>
			{#if task.progress !== null}
				<div
					class="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-200"
					style:width={`${task.progress}%`}
				></div>
			{/if}
			<div class="progress-sweep absolute inset-y-0 w-1/3"></div>
		</div>
	{/if}
</div>

<style>
	.progress-sweep {
		background: linear-gradient(to right, transparent, rgb(255 255 255 / 55%), transparent);
		animation: progress-sweep 1.25s ease-in-out infinite;
	}

	@keyframes progress-sweep {
		from {
			transform: translateX(-120%);
		}
		to {
			transform: translateX(420%);
		}
	}
</style>
