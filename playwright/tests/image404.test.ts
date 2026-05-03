import { test, expect } from '@playwright/test';

test('detect 404 images on all pages via network', async ({ page, baseURL }) => {
  const base = (baseURL ?? '').replace(/\/$/, '');
  const visited = new Set<string>();
  const queue: string[] = [`${base}/`];
  const brokenImages: { pageUrl: string; imageUrl: string }[] = [];

  while (queue.length > 0) {
    const currentUrl = queue.shift()!;
    if (visited.has(currentUrl)) {
      continue;
    }
    visited.add(currentUrl);

    await page.goto(currentUrl, { waitUntil: 'networkidle' });

    // Check for broken images using DOM inspection: any image that failed to load
    // (404, CORS, missing file, etc.) will have naturalWidth === 0 when complete
    const brokenSrcs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src]'))
        .filter(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 0)
        .map(img => (img as HTMLImageElement).src)
    );

    for (const src of brokenSrcs) {
      console.log(`Broken image found: ${src} on page ${currentUrl}`);
      brokenImages.push({ pageUrl: currentUrl, imageUrl: src });
    }

    // Collect all internal links from this page using Playwright's locator API
    const anchors = await page.locator('a[href]').all();
    for (const anchor of anchors) {
      const href = await anchor.getAttribute('href');
      if (!href) {
        continue;
      }
      // Resolve relative URLs against the current page URL
      const resolved = new URL(href, currentUrl);
      resolved.hash = '';
      const link = resolved.toString();
      if (link.startsWith(base) && !visited.has(link)) {
        queue.push(link);
      }
    }
  }

  const report = brokenImages.map(b => `  [${b.pageUrl}] ${b.imageUrl}`).join('\n');
  expect(brokenImages, `Broken images found:\n${report}`).toHaveLength(0);
});
