import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage: node screenshot.mjs <url> [label]');
  console.log('Example: node screenshot.mjs http://localhost:3000 initial-build');
  process.exit(1);
}

const url = args[0];
const label = args[1] || 'screenshot';
const outputDir = path.join(__dirname, 'temporary_screenshots');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Force all animated elements visible and trigger lazy-loading for screenshot accuracy
async function revealAllAnimations(page) {
  // 1. Force fade-up elements visible + convert lazy images to eager
  await page.evaluate(() => {
    document.querySelectorAll('.fade-up').forEach(el => el.classList.add('visible'));
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
      img.setAttribute('loading', 'eager');
    });
  });

  // 2. Scroll through entire page so browser loads everything
  await page.evaluate(async () => {
    const totalHeight = document.body.scrollHeight;
    const step = 400;
    for (let pos = 0; pos <= totalHeight; pos += step) {
      window.scrollTo(0, pos);
      await new Promise(r => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });

  // 3. Wait for all images to finish loading (max 5s)
  await page.evaluate(() => new Promise(resolve => {
    const imgs = Array.from(document.images).filter(img => !img.complete);
    if (imgs.length === 0) return resolve();
    let remaining = imgs.length;
    const done = () => { if (--remaining <= 0) resolve(); };
    imgs.forEach(img => {
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
    setTimeout(resolve, 5000);
  }));

  await new Promise(r => setTimeout(r, 300));
}

function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function takeScreenshots() {
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error('No Chrome/Edge found. Install Chrome or set PUPPETEER_EXECUTABLE_PATH.');
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Get all pages from the URL
  const page = await browser.newPage();

  // Desktop screenshot
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await revealAllAnimations(page);
  await page.screenshot({
    path: path.join(outputDir, `${label}_desktop_${timestamp}.png`),
    fullPage: true,
  });
  console.log(`Desktop screenshot saved: ${label}_desktop_${timestamp}.png`);

  // Mobile screenshot
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await revealAllAnimations(page);
  await page.screenshot({
    path: path.join(outputDir, `${label}_mobile_${timestamp}.png`),
    fullPage: true,
  });
  console.log(`Mobile screenshot saved: ${label}_mobile_${timestamp}.png`);

  // Try to find and screenshot subpages
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  
  const links = await page.evaluate(() => {
    const baseUrl = window.location.origin;
    return [...new Set(
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(href => href.startsWith(baseUrl) && href !== window.location.href && href.endsWith('.html'))
    )];
  });

  for (const link of links.slice(0, 10)) {
    try {
      const pageName = path.basename(link, '.html');
      
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(link, { waitUntil: 'networkidle0', timeout: 15000 });
      await revealAllAnimations(page);
      await page.screenshot({
        path: path.join(outputDir, `${label}_${pageName}_desktop_${timestamp}.png`),
        fullPage: true,
      });
      console.log(`Desktop screenshot saved: ${label}_${pageName}_desktop_${timestamp}.png`);

      await page.setViewport({ width: 375, height: 812 });
      await page.goto(link, { waitUntil: 'networkidle0', timeout: 15000 });
      await revealAllAnimations(page);
      await page.screenshot({
        path: path.join(outputDir, `${label}_${pageName}_mobile_${timestamp}.png`),
        fullPage: true,
      });
      console.log(`Mobile screenshot saved: ${label}_${pageName}_mobile_${timestamp}.png`);
    } catch (e) {
      console.log(`Skipped ${link}: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\nAll screenshots saved to: ${outputDir}/`);
}

takeScreenshots().catch(console.error);
