<script lang="ts">
	import { Star } from '@lucide/svelte';

	interface Props {
		rating: number;
		onRate: (rating: number) => void;
		size?: number;
		class?: string;
	}

	let { rating, onRate, size = 12, class: idle = 'text-muted' }: Props = $props();
</script>

<div class="flex gap-0.5">
	{#each [1, 2, 3, 4, 5] as value (value)}
		<button
			type="button"
			aria-label={`Rate ${value} stars`}
			class="cursor-pointer transition-colors hover:text-text {idle}"
			onclick={(event) => {
				event.stopPropagation();
				onRate(value);
			}}
		>
			<Star {size} class={rating >= value ? 'fill-text text-text' : ''} />
		</button>
	{/each}
</div>
