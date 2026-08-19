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

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

async function photoRect(viewport: Locator, name: string): Promise<Box> {
	const rect = await viewport.getByRole('img', { name, exact: true }).first().boundingBox();
	if (!rect) throw new Error('photo is not visible in the viewport');
	return rect;
}

function pointAt(rect: Box, fx: number, fy: number) {
	return { x: rect.x + fx * rect.width, y: rect.y + fy * rect.height };
}

async function renderedPixel(page: Page, point: { x: number; y: number }) {
	return page.evaluate(({ x, y }) => {
		const canvas = document.querySelector<HTMLCanvasElement>('[data-photo-pyramid] canvas');
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;
		const context = canvas.getContext('2d');
		if (!context) return null;
		const data = context.getImageData(
			Math.round((x - rect.left) * scaleX),
			Math.round((y - rect.top) * scaleY),
			1,
			1
		).data;
		return data[3] === 0 ? null : [data[0], data[1], data[2]];
	}, point);
}

function luma([red, green, blue]: number[]) {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function dragThumb(page: Page, thumb: Locator, deltaX: number) {
	await thumb.scrollIntoViewIfNeeded();
	const box = await thumb.boundingBox();
	if (!box) throw new Error('slider thumb is not visible');
	const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + deltaX, start.y, { steps: 6 });
	await page.mouse.up();
}

test('builds a luminance range mask from the source and lights only what it selects', async ({
	page
}) => {
	await openEditor(page, 'range.png');
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	const aside = page.locator('aside');
	const overlay = viewport.locator('canvas.motion-mask');
	const rect = await photoRect(viewport, 'range.png');
	const shadowPoint = pointAt(rect, 0.06, 0.06);
	const highlightPoint = pointAt(rect, 0.88, 0.88);
	await expect.poll(() => renderedPixel(page, shadowPoint), { timeout: 20_000 }).not.toBeNull();
	const shadowBefore = (await renderedPixel(page, shadowPoint))!;
	const highlightBefore = (await renderedPixel(page, highlightPoint))!;
	expect(luma(shadowBefore)).toBeLessThan(luma(highlightBefore));

	await aside.getByRole('button', { name: 'luminance', exact: true }).click();
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{
				kind: 'luminance',
				name: 'Luminance range',
				components: [
					{
						type: 'luminance-range',
						operation: 'add',
						range: { low: 0.5, high: 1, feather: 0.1 },
						raster: { storageName: expect.any(String), digest: expect.any(String) }
					}
				]
			}
		]);
	await expect(overlay).toBeVisible({ timeout: 15_000 });
	const firstDigest = (await storedMasks(page))![0].components[0].raster.digest;

	const luminanceGroup = aside.getByRole('group', { name: 'luminance range' });
	await dragThumb(page, luminanceGroup.getByRole('slider', { name: 'Low' }), -10);
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.components?.[0]?.range?.low, {
			timeout: 15_000
		})
		.toBeLessThan(0.5);
	const dragged = (await storedMasks(page))![0].components[0];
	expect(dragged.range.low).toBeGreaterThan(0.3);
	expect(dragged.range.high).toBe(1);
	expect(dragged.raster.digest).not.toBe(firstDigest);
	await expect(overlay).toBeVisible();

	const exposure = aside.getByRole('textbox', { name: 'Exposure value' });
	await exposure.fill('2');
	await exposure.press('Enter');
	await expect
		.poll(async () => (await storedMasks(page))?.[0]?.adjustments?.light?.exposure, {
			timeout: 15_000
		})
		.toBe(2);
	await expect
		.poll(async () => luma((await renderedPixel(page, highlightPoint)) ?? highlightBefore), {
			timeout: 20_000
		})
		.toBeGreaterThan(luma(highlightBefore) + 12);
	const shadowAfter = (await renderedPixel(page, shadowPoint))!;
	expect(Math.abs(luma(shadowAfter) - luma(shadowBefore))).toBeLessThan(6);

	await aside.getByRole('radio', { name: 'intersect', exact: true }).click();
	await aside.getByRole('button', { name: 'colour range', exact: true }).click();
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{
				kind: 'luminance',
				components: [
					{ type: 'luminance-range', operation: 'add' },
					{
						type: 'color-range',
						operation: 'intersect',
						range: { hue: 210, width: 30, saturationFloor: 0.2, feather: 0.25 },
						raster: { storageName: expect.any(String) }
					}
				]
			}
		]);
	await expect(aside.getByRole('group', { name: 'colour range' })).toBeVisible();

	await aside.getByRole('button', { name: 'colour', exact: true }).click();
	await expect
		.poll(() => storedMasks(page), { timeout: 15_000 })
		.toMatchObject([
			{ kind: 'luminance' },
			{
				kind: 'color',
				name: 'Colour range',
				components: [{ type: 'color-range', operation: 'add', raster: { width: 512 } }]
			}
		]);
});
