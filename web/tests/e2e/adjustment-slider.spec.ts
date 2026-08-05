import { expect, test, type Page } from '@playwright/test';

function storedEdit(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('postframe');
		const edits = await app.getDirectoryHandle('edits');
		for await (const handle of edits.values()) {
			if (handle.kind !== 'file') continue;
			return JSON.parse(await (await handle.getFile()).text());
		}
		return null;
	});
}

async function storedMasks(page: Page) {
	return (await storedEdit(page))?.masks ?? null;
}

test('renders and persists every light control for a display photo', async ({ page }) => {
	const tileFailures: string[] = [];
	page.on('console', (message) => {
		if (/tile .*failed|could not be cloned/i.test(message.text()))
			tileFailures.push(message.text());
	});
	await page.goto('/?perf');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#000000');
		gradient.addColorStop(0.5, '#ff4838');
		gradient.addColorStop(1, '#ffffff');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'slider.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
	await expect(page.getByRole('img', { name: 'RGB waveform scope' })).toBeVisible();
	await expect(page.getByText('scope unavailable')).toHaveCount(0);
	await page.getByRole('radio', { name: 'Histogram scope' }).click();
	await expect(page.getByRole('img', { name: 'RGB histogram scope' })).toBeVisible();
	await expect(page.locator('.lc-path')).toHaveCount(4);
	const histogramSignature = () =>
		page
			.locator('.lc-path')
			.evaluateAll((paths) => paths.map((path) => path.getAttribute('d')).join('|'));

	const edits = [
		['Exposure', '0.50', '+0.50 EV'],
		['Contrast', '37', '+37'],
		['Highlights', '-28', '-28'],
		['Shadows', '34', '+34'],
		['Whites', '21', '+21'],
		['Blacks', '-16', '-16']
	] as const;
	for (const [label, draft, formatted] of edits) {
		const before = await histogramSignature();
		const value = page.getByRole('textbox', { name: `${label} value` });
		await value.fill(draft);
		await value.press('Enter');
		await expect(value).toHaveValue(formatted);
		await expect.poll(histogramSignature).not.toBe(before);
	}
	await expect(page.getByText(/refining tiles|applying light/)).toHaveCount(0, {
		timeout: 20_000
	});
	await expect(page.locator('[data-photo-pyramid] canvas')).toBeVisible();

	const value = page.getByRole('textbox', { name: 'Contrast value' });
	await page.getByRole('slider', { name: 'Contrast' }).dblclick();
	await expect(value).toHaveValue('0');

	await value.hover();
	await page.mouse.wheel(0, -100);
	await expect(value).toHaveValue('+1');
	await page.mouse.wheel(0, 100);
	await expect(value).toHaveValue('0');

	await expect
		.poll(() => storedEdit(page))
		.toMatchObject({
			version: 3,
			adjustments: {
				light: {
					exposure: 0.5,
					contrast: 0,
					highlights: -28,
					shadows: 34,
					whites: 21,
					blacks: -16
				}
			},
			geometry: {
				rotation: 0,
				flipHorizontal: false,
				flipVertical: false,
				crop: null
			},
			masks: []
		});

	await page.getByRole('tab', { name: /^mask/ }).click();
	await page.locator('aside').getByRole('button', { name: 'brush', exact: true }).click();
	await expect
		.poll(() => storedMasks(page))
		.toMatchObject([{ name: 'brush', kind: 'brush', visible: true }]);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => storedMasks(page)).toEqual([]);

	await page.getByRole('button', { name: 'Redo' }).click();
	await expect
		.poll(() => storedMasks(page))
		.toMatchObject([{ name: 'brush', kind: 'brush', visible: true }]);
	const performanceReport = await page.evaluate(() => window.__postframePerformance?.snapshot());
	expect(performanceReport).toMatchObject({
		sampleCapacity: 256,
		runtime: { threaded: true }
	});
	expect(performanceReport?.totalSamples).toBeGreaterThan(0);
	expect(performanceReport?.series.some(({ stage }) => stage === 'display-decode')).toBe(true);
	await expect.poll(() => tileFailures).toEqual([]);
});

test('keeps transparent PNG pixels transparent while developing', async ({ page }) => {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 8;
		const context = canvas.getContext('2d')!;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = '#49a7ff';
		context.fillRect(8, 0, 8, 8);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'transparent.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});

	const preview = page.getByRole('img', { name: 'transparent.png' }).first();
	await expect(preview).toBeVisible();
	await expect
		.poll(() =>
			preview.evaluate((image: HTMLImageElement) => {
				const canvas = document.createElement('canvas');
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext('2d')!;
				context.drawImage(image, 0, 0);
				return context.getImageData(0, 0, 1, 1).data[3];
			})
		)
		.toBe(0);

	const exposure = page.getByRole('textbox', { name: 'Exposure value' });
	await exposure.fill('1');
	await exposure.press('Enter');
	await expect(exposure).toHaveValue('+1.00 EV');
	await expect(page.locator('[data-photo-pyramid] canvas')).toBeVisible();
});
