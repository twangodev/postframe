<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';

	interface Props {
		label: string;
	}

	let { label }: Props = $props();
</script>

<span class="w-3"></span>
<span class="flex-1">{label}</span>
<ChevronRight size={11} class="text-muted" />
