<script lang="ts">
	import { Slider } from 'bits-ui';

	interface Props {
		label: string;
		value?: number;
		min: number;
		max: number;
		step?: number;
		suffix?: string;
		decimals?: number;
		signed?: boolean;
		disabled?: boolean;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
	}

	let {
		label,
		value = $bindable(0),
		min,
		max,
		step = 1,
		suffix = '',
		decimals = 0,
		signed = true,
		disabled = false,
		onValueChange = () => {},
		onValueCommit = () => {}
	}: Props = $props();

	const formatted = $derived(
		`${signed && value > 0 ? '+' : ''}${value.toFixed(decimals)}${suffix}`
	);
</script>

<div
	class="grid grid-cols-[4.75rem_1fr_2.75rem] items-center gap-2 py-1 transition-opacity"
	class:opacity-40={disabled}
>
	<span class="text-text/75 truncate text-[10px] lowercase">{label}</span>
	<Slider.Root
		type="single"
		bind:value
		{min}
		{max}
		{step}
		{disabled}
		{onValueChange}
		{onValueCommit}
		class="relative flex h-4 w-full touch-none items-center"
	>
		{#snippet children({ thumbItems })}
			<span class="bg-muted/35 absolute inset-x-0 h-px"></span>
			<Slider.Range class="bg-text/70 absolute h-px" />
			{#each thumbItems as thumb (thumb.index)}
				<Slider.Thumb
					index={thumb.index}
					aria-label={label}
					class="border-text/70 bg-surface focus-visible:outline-accent block size-2.5 rounded-full border shadow-sm transition-transform hover:scale-125 focus-visible:outline-2"
				/>
			{/each}
		{/snippet}
	</Slider.Root>
	<span class="text-muted text-right font-mono text-[10px] tabular-nums">{formatted}</span>
</div>
