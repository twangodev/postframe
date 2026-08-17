<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		children: Snippet<[Record<string, unknown>]>;
	}

	let { text, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={350}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render children(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				sideOffset={6}
				class="motion-tooltip z-50 max-w-64 rounded border border-subtle bg-bg px-2.5 py-1.5 text-[11px] tracking-wide text-muted lowercase shadow-xl"
			>
				{text}
				<Tooltip.Arrow class="fill-bg" />
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
