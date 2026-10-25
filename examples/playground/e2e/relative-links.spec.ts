import { expect, test } from '@playwright/test';

// The site is served from a subpath on GitHub Pages (https://vieirin.github.io/istar-ts/), so a
// link starting with "/" escapes it and 404s. Vite rewrites asset URLs (`base: './'`), not anchors.
for (const page of ['/', '/react.html', '/glsp.html', '/both.html', '/both.html?server=worker']) {
  test(`no root-absolute links on ${page}`, async ({ page: p }) => {
    await p.goto(page);
    await p.waitForLoadState('networkidle');
    const absolute = await p
      .locator('a[href]')
      .evaluateAll((links) =>
        links.map((a) => a.getAttribute('href') ?? '').filter((href) => href.startsWith('/')),
      );
    expect(absolute).toEqual([]);
  });
}
