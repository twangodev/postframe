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

test('mixes a hue band and grades a tonal range through the panel', async ({ page }) => {
	test.setTimeout(90_000);
	const cloneFailures: string[] = [];
	page.on('console', (message) => {
		if (/could not be cloned|tile .*failed/i.test(message.text()))
			cloneFailures.push(message.text());
	});
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#0d1f6b');
		gradient.addColorStop(0.4, '#1f8fd6');
		gradient.addColorStop(0.7, '#d24a2f');
		gradient.addColorStop(1, '#f4e7c3');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'mixer.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Temperature value' })).toBeEnabled({
		timeout: 20_000
	});
	await page.getByRole('radio', { name: 'Histogram scope' }).click();
	await expect(page.locator('.lc-path')).toHaveCount(4);
	const histogramSignature = () =>
		page
			.locator('.lc-path')
			.evaluateAll((paths) => paths.map((path) => path.getAttribute('d')).join('|'));

	await page.getByRole('button', { name: 'open color mixer' }).click();
	await page.getByRole('radio', { name: 'blue', exact: true }).click();
	const bandSaturation = page.getByRole('textbox', { name: 'Band saturation value', exact: true });
	await expect(bandSaturation).toBeEnabled();

	const beforeMixer = await histogramSignature();
	await bandSaturation.fill('-100');
	await bandSaturation.press('Enter');
	await expect(bandSaturation).toHaveValue('-100');
	await expect.poll(histogramSignature).not.toBe(beforeMixer);
	await expect
		.poll(() => storedAdjustments(page), { timeout: 15_000 })
		.toMatchObject({
			mixer: {
				blue: { hue: 0, saturation: -100, luminance: 0 },
				red: { hue: 0, saturation: 0, luminance: 0 }
			}
		});

	await page.getByRole('button', { name: 'Color grading' }).click();
	const disc = page.getByRole('slider', { name: 'shadows hue and saturation' });
	await disc.hover();
	const bounds = (await disc.boundingBox())!;
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.86, bounds.y + bounds.height / 2, { steps: 4 });
	await page.mouse.up();

	const shown = await disc.getAttribute('aria-valuetext');
	await expect
		.poll(
			async () => {
				const wheel = (await storedAdjustments(page))?.grading?.shadows;
				if (!wheel) return null;
				return {
					clockwiseFromTop: wheel.hue > 30 && wheel.hue < 150,
					saturated: wheel.saturation > 40,
					shown: `hue ${wheel.hue.toFixed(0)}, saturation ${wheel.saturation.toFixed(0)}`
				};
			},
			{ timeout: 15_000 }
		)
		.toEqual({ clockwiseFromTop: true, saturated: true, shown });

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect
		.poll(async () => (await storedAdjustments(page))?.grading?.shadows?.saturation, {
			timeout: 15_000
		})
		.toBe(0);
	await expect
		.poll(async () => (await storedAdjustments(page))?.mixer?.blue?.saturation, {
			timeout: 15_000
		})
		.toBe(-100);

	await expect(page.getByText(/refining tiles|applying light/)).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => cloneFailures).toEqual([]);
});
