import { expect, test, type Page } from '@playwright/test';

function storedAdjustments(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('postframe');
		const edits = await app.getDirectoryHandle('edits');
		for await (const handle of edits.values()) {
			if (handle.kind !== 'file') continue;
			try {
				return JSON.parse(await (await handle.getFile()).text()).adjustments;
			} catch {
				return null;
			}
		}
		return null;
	});
}

function tileSamples(page: Page) {
	return page.evaluate(
		() =>
			window.__postframePerformance
				?.snapshot()
				.series.filter(({ stage }) => stage === 'tile')
				.reduce((total, { samples }) => total + samples, 0) ?? 0
	);
}

function viewportCentrePixel(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>('[data-photo-pyramid] canvas');
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return null;
		const [red, green, blue, alpha] = context.getImageData(
			Math.floor(canvas.width / 2),
			Math.floor(canvas.height / 2),
			1,
			1
		).data;
		return { red, green, blue, alpha };
	});
}

function blueCastGreyJpegWithBlownWhiteCentre(page: Page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 64;
		const context = canvas.getContext('2d')!;
		context.fillStyle = 'rgb(122, 126, 142)';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = '#ffffff';
		context.fillRect(36, 20, 24, 24);
		return canvas.toDataURL('image/jpeg', 0.95);
	});
}

test('balances white from a click or the whole frame and paints clipping on demand', async ({
	page
}) => {
	test.setTimeout(90_000);
	const failures: string[] = [];
	page.on('console', (message) => {
		if (/could not be cloned|tile .*failed|failed:/i.test(message.text()))
			failures.push(message.text());
	});
	await page.goto('/?perf');
	const dataUrl = await blueCastGreyJpegWithBlownWhiteCentre(page);
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'cast.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	const temperature = page.getByRole('textbox', { name: 'Temperature value' });
	const tint = page.getByRole('textbox', { name: 'Tint value' });
	await expect(temperature).toBeEnabled({ timeout: 20_000 });
	await expect(temperature).toHaveValue('0');
	await expect(page.locator('[data-photo-pyramid] canvas')).toBeVisible();

	await page.getByRole('button', { name: 'Auto white balance' }).click();
	await expect(temperature).not.toHaveValue('0');
	await expect(tint).not.toHaveValue('0');
	await expect
		.poll(async () => (await storedAdjustments(page))?.color?.temperature, { timeout: 15_000 })
		.toBeGreaterThan(20);
	await page.getByRole('button', { name: 'History' }).click();
	await expect(page.getByText('auto white balance', { exact: true })).toBeVisible();

	const shadowsToggle = page.getByRole('button', { name: 'Show shadow clipping' });
	const highlightsToggle = page.getByRole('button', { name: 'Show highlight clipping' });
	await expect(shadowsToggle).toHaveAttribute('aria-pressed', 'false');
	await expect(highlightsToggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText(/refining tiles|applying light/)).toHaveCount(0, { timeout: 20_000 });
	await page.keyboard.press('1');
	await expect(page.getByRole('button', { name: 'Choose zoom level' })).toHaveText('100%');
	const warmedWhiteStillClips = { red: 255, green: 255, alpha: 255 };
	await expect
		.poll(() => viewportCentrePixel(page), { timeout: 15_000 })
		.toMatchObject(warmedWhiteStillClips);

	const samplesBefore = await tileSamples(page);
	await page.keyboard.press('j');
	await expect(shadowsToggle).toHaveAttribute('aria-pressed', 'true');
	await expect(highlightsToggle).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => tileSamples(page), { timeout: 15_000 }).toBeGreaterThan(samplesBefore);
	await expect
		.poll(() => viewportCentrePixel(page), { timeout: 15_000 })
		.toMatchObject({
			red: 255,
			green: 32,
			blue: 32,
			alpha: 255
		});
	await page.keyboard.press('j');
	await expect(highlightsToggle).toHaveAttribute('aria-pressed', 'false');
	await expect
		.poll(() => viewportCentrePixel(page), { timeout: 15_000 })
		.toMatchObject({
			red: 255,
			green: 255
		});

	await page.keyboard.press('0');
	const eyedropper = page.getByRole('button', { name: 'White balance eyedropper' });
	await eyedropper.click();
	await expect(eyedropper).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByText('click a neutral grey or white')).toBeVisible();
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	await expect(viewport).toHaveClass(/cursor-crosshair/);
	const box = (await viewport.boundingBox())!;
	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
	await expect(page.getByText('white balance', { exact: true })).toBeVisible();
	const samplingTheNeutralSquareUndidTheCastWithinJpegNoise = async () => {
		const color = (await storedAdjustments(page))?.color;
		return color && Math.abs(color.temperature) <= 2 && Math.abs(color.tint) <= 2;
	};
	await expect
		.poll(samplingTheNeutralSquareUndidTheCastWithinJpegNoise, { timeout: 15_000 })
		.toBe(true);

	await page.getByRole('button', { name: 'Auto tone' }).click();
	await expect(page.getByText('auto tone', { exact: true })).toBeVisible();
	await expect
		.poll(async () => (await storedAdjustments(page))?.light, { timeout: 15_000 })
		.toMatchObject({ contrast: 0, highlights: 0, shadows: 0 });
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).not.toHaveValue('0.00 EV');
	await expect.poll(() => failures).toEqual([]);
});
