<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { MonitorUp } from '@lucide/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import EditWorkspace from '$lib/components/EditWorkspace.svelte';
	import ExportDialog from '$lib/components/ExportDialog.svelte';
	import OrganizeWorkspace from '$lib/components/OrganizeWorkspace.svelte';
	import TaskManager from '$lib/components/ui/TaskManager.svelte';
	import Welcome from '$lib/components/Welcome.svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import { secondaryButtonClass } from '$lib/button';
	import { WorkspaceState } from '$lib/workspace.svelte';

	const workspace = new WorkspaceState();
	let exportOpen = $state(false);

	onDestroy(workspace.destroy);
	onMount(() => {
		workspace.preloadSmartMaskModels();
	});
</script>

<svelte:head>
	<title>postframe | photo workspace</title>
</svelte:head>

{#if !workspace.startupReady}
	<main class="flex min-h-svh items-center justify-center bg-bg text-text">
		<div class="motion-enter flex items-center gap-2">
			<img src={postframeLogo} alt="" class="size-7" />
			<span class="text-[14px] font-medium tracking-tight">postframe</span>
		</div>
	</main>
{:else if workspace.mode === 'welcome'}
	<Welcome
		{workspace}
		acceptedPhotos={workspace.acceptedPhotos}
		sourceReady={workspace.capabilitiesReady}
		ingestError={workspace.ingestError}
		libraryError={workspace.libraryError}
		onOpenPhoto={workspace.openSingle}
		onCreateCollection={workspace.createCollection}
		onEnterLibrary={workspace.enterLibrary}
	/>
{:else}
	<div class="hidden h-svh min-h-0 flex-col bg-bg text-text min-[900px]:flex">
		<AppHeader {workspace} onExport={() => (exportOpen = true)} />
		{#key workspace.mode}
			<div class="motion-workspace flex min-h-0 flex-1 overflow-hidden">
				{#if workspace.mode === 'organize'}
					<OrganizeWorkspace {workspace} />
				{:else}
					<EditWorkspace {workspace} onExport={() => (exportOpen = true)} />
				{/if}
			</div>
		{/key}
	</div>

	<div
		class="flex min-h-svh flex-col items-center justify-center bg-bg px-8 text-center min-[900px]:hidden"
	>
		<MonitorUp size={30} strokeWidth={1} class="mb-5 text-muted" />
		<p class="text-[11px] tracking-[0.04em] text-accent">desktop workspace</p>
		<h1 class="mt-3 text-xl font-medium tracking-tight">a little more room, please.</h1>
		<p class="mt-3 max-w-sm text-xs leading-relaxed text-muted">
			postframe's editing workspace is designed for displays at least 900 pixels wide. your files
			remain in this browser's local storage.
		</p>
		<button type="button" class="mt-6 {secondaryButtonClass}" onclick={workspace.reset}>
			back to start
		</button>
	</div>

	<ExportDialog bind:open={exportOpen} {workspace} />
{/if}

<TaskManager
	tasks={workspace.backgroundTasks}
	cancel={{ key: 'develop', run: workspace.cancelDocument }}
/>
