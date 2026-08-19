<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Size } from '$lib/photo-viewport';

	interface Props {
		image: Size;
		children: Snippet;
	}

	let { image, children }: Props = $props();
</script>

<svg
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full overflow-visible"
	viewBox={`0 0 ${image.width} ${image.height}`}
	preserveAspectRatio="none"
>
	{@render children()}
</svg>
