import { expect, test, type Locator, type Page } from '@playwright/test';

// Panels slide open over 200ms; poll scrollIntoView until the target is actually inside the aside.
async function revealInAside(target: Locator) {
	await expect
		.poll(() =>
			target.evaluate((element) => {
				element.scrollIntoView({ block: 'nearest' });
				const aside = element.closest('aside');
				if (!aside) return false;
				const bounds = aside.getBoundingClientRect();
				const rect = element.getBoundingClientRect();
				return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
			})
		)
		.toBe(true);
}

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

async function storedMask(page: Page) {
	return (await storedEdit(page))?.masks?.[0] ?? null;
}

async function openMaskTab(page: Page, name: string) {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 512;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#1c2f4a');
		gradient.addColorStop(0.5, '#c8552a');
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

async function paintBrushMask(page: Page, name: string) {
	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	await page.locator('aside').getByRole('button', { name: 'brush', exact: true }).click();
	const rect = await viewport.getByRole('img', { name, exact: true }).first().boundingBox();
	if (!rect) throw new Error('photo is not visible in the viewport');
	await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.35);
	await page.mouse.down();
	await page.mouse.move(rect.x + rect.width * 0.65, rect.y + rect.height * 0.6, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(() => storedMask(page), { timeout: 15_000 })
		.toMatchObject({ kind: 'brush', components: [{ type: 'brush', operation: 'add' }] });
}

test('shapes the selected mask with the curve, mixer and grading sections', async ({ page }) => {
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1600, height: 1200 });
	await openMaskTab(page, 'tools.png');
	await paintBrushMask(page, 'tools.png');
	const aside = page.locator('aside');

	await aside.getByRole('button', { name: /^Curve/ }).click();
	const plot = aside.getByRole('application', { name: /tone curve/ });
	await revealInAside(plot);
	await expect(plot).toHaveAttribute('aria-disabled', 'false');
	// The mask plot draws no histogram backdrop; the document's tones are not its own.
	await expect(plot.locator('polygon')).toHaveCount(0);
	const box = (await plot.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () => (await storedMask(page))?.adjustments?.curve?.luminance?.length, {
			timeout: 15_000
		})
		.toBe(3);
	await expect(aside.getByRole('button', { name: /^Curve\s*L$/ })).toBeVisible();

	await aside.getByRole('button', { name: 'Color mixer' }).click();
	await aside.getByRole('radio', { name: 'blue', exact: true }).click();
	const bandSaturation = aside.getByRole('textbox', { name: 'Band saturation value', exact: true });
	await expect(bandSaturation).toBeEnabled();
	await bandSaturation.fill('-100');
	await bandSaturation.press('Enter');
	await expect(bandSaturation).toHaveValue('-100');
	await expect
		.poll(async () => (await storedMask(page))?.adjustments?.mixer?.blue, { timeout: 15_000 })
		.toEqual({ hue: 0, saturation: -100, luminance: 0 });

	await aside.getByRole('button', { name: 'Color grading' }).click();
	const disc = aside.getByRole('slider', { name: 'shadows hue and saturation' });
	await revealInAside(disc);
	const bounds = (await disc.boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.86, bounds.y + bounds.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => (await storedMask(page))?.adjustments?.grading?.shadows?.saturation, {
			timeout: 15_000
		})
		.toBeGreaterThan(40);

	// The document's own settings never moved: every edit landed on the mask.
	const edit = await storedEdit(page);
	expect(edit.adjustments.curve.luminance).toEqual([
		{ x: 0, y: 0 },
		{ x: 1, y: 1 }
	]);
	expect(edit.adjustments.mixer.blue).toEqual({ hue: 0, saturation: 0, luminance: 0 });
	expect(edit.adjustments.grading.shadows.saturation).toBe(0);
	expect(edit.masks[0].adjustments.curve.luminance[1].y).toBeGreaterThan(
		edit.masks[0].adjustments.curve.luminance[1].x
	);

	await page.getByRole('button', { name: 'Undo' }).click();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect
		.poll(async () => (await storedMask(page))?.adjustments?.grading?.shadows?.saturation, {
			timeout: 15_000
		})
		.toBe(0);
	await expect
		.poll(async () => (await storedMask(page))?.adjustments?.mixer?.blue?.saturation, {
			timeout: 15_000
		})
		.toBe(-100);
});
