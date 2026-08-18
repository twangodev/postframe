import { expect, test, type Page } from '@playwright/test';

async function openTexturedJpeg(page: Page) {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 1024;
		canvas.height = 768;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#2b3a4a');
		gradient.addColorStop(1, '#d9c7a8');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		let seed = 4183;
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let y = 0; y < canvas.height; y += 32) {
			for (let x = 0; x < canvas.width; x += 32) {
				const shade = Math.round(60 + random() * 140);
				context.fillStyle = `rgba(${shade}, ${shade + 10}, ${shade - 10}, 0.6)`;
				context.fillRect(x + 4, y + 4, 24, 24);
			}
		}
		context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
		for (let offset = -canvas.height; offset < canvas.width; offset += 12) {
			context.beginPath();
			context.moveTo(offset, 0);
			context.lineTo(offset + canvas.height, canvas.height);
			context.stroke();
		}
		return canvas.toDataURL('image/jpeg', 0.92);
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'texture.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
	await page.getByRole('button', { name: 'Presence' }).click();
	await page.getByRole('button', { name: 'Detail', exact: true }).click();
	await expect(page.locator('[data-photo-pyramid] canvas')).toBeVisible();
	await settled(page);
}

async function settled(page: Page) {
	await expect(page.getByText(/refining tiles|applying light/)).toHaveCount(0, {
		timeout: 20_000
	});
}

function viewportVariance(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>('[data-photo-pyramid] canvas');
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return null;
		const box = {
			x: Math.floor(canvas.width * 0.3),
			y: Math.floor(canvas.height * 0.3),
			width: Math.floor(canvas.width * 0.4),
			height: Math.floor(canvas.height * 0.4)
		};
		const { data } = context.getImageData(box.x, box.y, box.width, box.height);
		let sum = 0;
		let squares = 0;
		let opaque = 0;
		for (let index = 0; index < data.length; index += 4) {
			if (data[index + 3] === 0) continue;
			const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
			sum += luminance;
			squares += luminance * luminance;
			opaque += 1;
		}
		if (opaque === 0) return null;
		const mean = sum / opaque;
		return squares / opaque - mean * mean;
	});
}

// Tiles are deterministic, so the viewport has finished refining once three
// samples half a second apart agree.
async function stableViewportVariance(page: Page) {
	const recent: (number | null)[] = [];
	await expect
		.poll(
			async () => {
				recent.push(await viewportVariance(page));
				const window = recent.slice(-3);
				return (
					window.length === 3 && window.every((value) => value !== null && value === window[0])
				);
			},
			{ timeout: 20_000, intervals: [500] }
		)
		.toBe(true);
	return recent.at(-1)!;
}

async function setDetail(page: Page, label: string, draft: string, formatted: string) {
	const value = page.getByRole('textbox', { name: `${label} value` });
	await value.fill(draft);
	await value.press('Enter');
	await expect(value).toHaveValue(formatted);
}

test('clarity raises the local contrast of a jpeg in the viewport', async ({ page }) => {
	const tileFailures: string[] = [];
	page.on('console', (message) => {
		if (/tile .*failed|could not be cloned/i.test(message.text()))
			tileFailures.push(message.text());
	});
	await openTexturedJpeg(page);
	const neutral = await stableViewportVariance(page);
	expect(neutral).toBeGreaterThan(0);

	await setDetail(page, 'Clarity', '100', '+100');
	await settled(page);
	await expect
		.poll(() => viewportVariance(page), { timeout: 20_000 })
		.toBeGreaterThan(neutral * 1.05);

	await setDetail(page, 'Clarity', '0', '0');
	await settled(page);
	await expect
		.poll(async () => Math.abs((await viewportVariance(page))! - neutral) / neutral, {
			timeout: 20_000
		})
		.toBeLessThan(0.1);
	await expect.poll(() => tileFailures).toEqual([]);
});
