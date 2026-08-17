import { expect, test, type Locator, type Page } from '@playwright/test';

function storedEdit(page: Page) {
	return page.evaluate(async () => {
		try {
			const root = await navigator.storage.getDirectory();
			const app = await root.getDirectoryHandle('postframe');
			const edits = await app.getDirectoryHandle('edits');
			for await (const handle of edits.values()) {
				if (handle.kind !== 'file') continue;
				return JSON.parse(await (await handle.getFile()).text());
			}
		} catch {
			return null;
		}
		return null;
	});
}

async function storedMasks(page: Page) {
	return (await storedEdit(page))?.masks ?? null;
}

async function openEditor(page: Page, name: string) {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 512;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#1c2f4a');
		gradient.addColorStop(1, '#e8dcc4');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name,
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
	await page.getByRole('tab', { name: /^mask/ }).click();
}

async function photoRect(viewport: Locator, name: string) {
	const rect = await viewport.getByRole('img', { name, exact: true }).first().boundingBox();
	if (!rect) throw new Error('photo is not visible in the viewport');
	return rect;
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

function pointAt(rect: Box, fx: number, fy: number) {
	return { x: rect.x + fx * rect.width, y: rect.y + fy * rect.height };
}

async function dragStroke(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number }
) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

test('layers brush strokes and gradient drags into persistent masks', async ({ page }) => {
	await openEditor(page, 'paint.png');
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	const layers = page.getByRole('button', { name: 'Hide mask', exact: true });
	const aside = page.locator('aside');
	const rect = await photoRect(viewport, 'paint.png');

	await aside.getByRole('button', { name: 'brush', exact: true }).click();
	await dragStroke(page, pointAt(rect, 0.3, 0.35), pointAt(rect, 0.62, 0.55));
	await expect(layers).toHaveCount(1);
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([{ kind: 'brush', components: [{ type: 'brush', operation: 'add' }] }]);

	await dragStroke(page, pointAt(rect, 0.55, 0.62), pointAt(rect, 0.72, 0.42));
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.components?.[0]?.strokes?.length, {
			timeout: 15_000
		})
		.toBe(2);
	await expect(layers).toHaveCount(1);

	await aside.getByRole('button', { name: 'subtract', exact: true }).click();
	await dragStroke(page, pointAt(rect, 0.45, 0.5), pointAt(rect, 0.6, 0.6));
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{
				kind: 'brush',
				components: [
					{ type: 'brush', operation: 'add' },
					{ type: 'brush', operation: 'subtract' }
				]
			}
		]);
	await expect(layers).toHaveCount(1);

	await aside.getByRole('button', { name: 'linear', exact: true }).click();
	const linearStart = pointAt(rect, 0.35, 0.65);
	const linearEnd = pointAt(rect, 0.65, 0.35);
	await page.mouse.move(linearStart.x, linearStart.y);
	await page.mouse.down();
	await page.mouse.move(linearEnd.x, linearEnd.y, { steps: 8 });
	await expect(viewport.locator('svg[preserveAspectRatio="none"] line')).toHaveCount(6);
	await page.mouse.up();
	await expect(layers).toHaveCount(2);
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{ kind: 'brush' },
			{ kind: 'linear', components: [{ type: 'linear', operation: 'add' }] }
		]);

	await aside.getByRole('button', { name: 'radial', exact: true }).click();
	await dragStroke(page, pointAt(rect, 0.5, 0.5), pointAt(rect, 0.68, 0.6));
	await expect(layers).toHaveCount(3);
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{ kind: 'brush', name: 'brush' },
			{ kind: 'linear', name: 'linear gradient' },
			{
				kind: 'radial',
				name: 'radial gradient',
				components: [{ type: 'radial', operation: 'add' }]
			}
		]);

	await page.reload();
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{ kind: 'brush', visible: true },
			{ kind: 'linear', visible: true },
			{ kind: 'radial', visible: true }
		]);
	await page.getByRole('button', { name: 'Select paint.png' }).click();
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
	await page.getByRole('tab', { name: /^mask/ }).click();
	await expect(layers).toHaveCount(3);
});

test('keeps the live gradient preview mounted until the committed overlay returns', async ({
	page
}) => {
	await openEditor(page, 'preview.png');
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	const preview = viewport.locator('canvas[aria-hidden="true"].absolute');
	const overlay = viewport.locator('canvas.motion-mask');

	await page.locator('aside').getByRole('button', { name: 'linear', exact: true }).click();
	const rect = await photoRect(viewport, 'preview.png');
	const start = pointAt(rect, 0.32, 0.62);
	const end = pointAt(rect, 0.66, 0.36);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 10 });

	await expect(preview).toBeVisible();
	await expect(viewport.locator('svg[preserveAspectRatio="none"] line')).toHaveCount(6);

	await page.evaluate(() => {
		const state = { gapFrames: 0, sawOverlay: false };
		(window as unknown as { __paintHandoff?: typeof state }).__paintHandoff = state;
		const watch = () => {
			const surface = document.querySelector('[aria-label="Photo viewport"]');
			if (surface?.querySelector('canvas.motion-mask')) {
				state.sawOverlay = true;
				return;
			}
			if (!surface?.querySelector('canvas[aria-hidden="true"].absolute')) state.gapFrames += 1;
			requestAnimationFrame(watch);
		};
		requestAnimationFrame(watch);
	});
	await page.mouse.up();

	await expect(overlay).toBeVisible({ timeout: 15_000 });
	await expect(preview).toHaveCount(0);
	const handoff = () =>
		page.evaluate(
			() =>
				(window as unknown as { __paintHandoff?: { gapFrames: number; sawOverlay: boolean } })
					.__paintHandoff
		);
	await expect.poll(async () => (await handoff())?.sawOverlay).toBe(true);
	expect((await handoff())?.gapFrames).toBe(0);
});

test('edits a linear gradient with its on-canvas handles', async ({ page }) => {
	await openEditor(page, 'gizmo.png');
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	const aside = page.locator('aside');
	const rect = await photoRect(viewport, 'gizmo.png');
	const guideLines = viewport.locator('svg[preserveAspectRatio="none"] line');

	await aside.getByRole('button', { name: 'linear', exact: true }).click();
	await dragStroke(page, pointAt(rect, 0.3, 0.5), pointAt(rect, 0.7, 0.5));
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([{ kind: 'linear', components: [{ type: 'linear' }] }]);
	const placed = (await storedMasks(page))![0].components[0];
	expect(placed.anchor).toEqual({ x: 0.5, y: 0.5 });

	// A second mask takes the selection; reselecting the linear mask must show
	// its gizmo even though the active tool is now the radial one.
	await aside.getByRole('button', { name: 'radial', exact: true }).click();
	await dragStroke(page, pointAt(rect, 0.5, 0.25), pointAt(rect, 0.6, 0.3));
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([{ kind: 'linear' }, { kind: 'radial' }]);
	await aside.getByRole('button', { name: /linear gradient/ }).click();
	await expect(guideLines).toHaveCount(6);

	// Drag the positive endpoint dot: rotation and compression change, the
	// anchor does not.
	await dragStroke(page, pointAt(rect, 0.7, 0.5), pointAt(rect, 0.5, 0.28));
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.components?.[0]?.rotation, {
			timeout: 15_000
		})
		.not.toBe(placed.rotation);
	const rotated = (await storedMasks(page))![0].components[0];
	expect(rotated.anchor).toEqual(placed.anchor);
	expect(rotated.rotation).toBeLessThan(0);

	// Drag the dashed center line through the anchor: pure translation.
	await dragStroke(page, pointAt(rect, 0.5, 0.5), pointAt(rect, 0.58, 0.6));
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.components?.[0]?.anchor?.x, {
			timeout: 15_000
		})
		.toBeGreaterThan(0.55);

	// Undo restores the pre-translation geometry in one step.
	await page.keyboard.press('Control+z');
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.components?.[0]?.anchor?.x, {
			timeout: 15_000
		})
		.toBe(rotated.anchor.x);
});
