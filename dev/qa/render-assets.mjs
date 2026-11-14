// Renders the social share image and the apple touch icon with headless Chrome.
import puppeteer from 'puppeteer-core';
const base = process.argv[2] || 'http://localhost:4321/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.goto(base + '_og.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'site/assets/img/og-image.png' });
await page.setViewport({ width: 180, height: 180, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:#141513"><svg viewBox="0 0 32 32" width="180" height="180" style="display:block"><rect width="32" height="32" fill="#141513"/><path d="M4.5 16 L6 12.2 L7.4 19.6 L8.8 13.1 L10.1 18.7 L11.3 14.4 L12.4 17.4 L13.4 15.4 L14.2 16 C15.6 16 16.3 10.4 18.5 10.4 C20.7 10.4 21.3 21.6 23.5 21.6 C25.3 21.6 26 16 27.5 16" fill="none" stroke="#FF5A26" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" transform="translate(16 16) scale(0.82) translate(-16 -16)"/></svg></body></html>`);
await page.screenshot({ path: 'site/assets/img/apple-touch-icon.png' });
await browser.close();
console.log('rendered og-image.png and apple-touch-icon.png');
