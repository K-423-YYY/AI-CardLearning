const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const requireFromRuntime = createRequire(path.join(__dirname, '..', 'app', 'x.js'));
const { chromium } = requireFromRuntime(
  'C:/Users/29137/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const BASE = 'http://127.0.0.1:8765/index.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function collectLayoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const ignored = new Set(['.level-path-wrap', 'BODY', 'HTML']);
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).map((c) => '.' + c).join('') : '';
      const key = el.id ? '#' + el.id : cls || el.tagName;
      if (ignored.has(el.tagName) || ignored.has(cls)) return;
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
        issues.push(`${key} overflow ${el.scrollWidth}x${el.scrollHeight} vs ${el.clientWidth}x${el.clientHeight} text="${el.textContent.trim().slice(0, 40)}"`);
      }
    });
    return issues.slice(0, 20);
  });
}

async function seedZone(page) {
  await page.evaluate(async () => {
    const zone = await LocalCoreInstance.createZone('验证学习区');
    await LocalCoreInstance.addFile(zone.id, { filename: 'verify.txt', content: '验证内容' });
    await LocalCoreInstance.generateCard(zone.id, { title: '验证卡片', block_name: '区块', difficulty: '中' }, {
      question: '验证题干是否溢出容器宽度？',
      option_a: '选项A 内容',
      option_b: '选项B 内容',
      option_c: '选项C 内容',
      option_d: '选项D 内容',
      answer: 'A',
      explanation: '这是解析内容',
      label: '必考'
    }, 1);
    await LocalCoreInstance.rebuildZoneLevels(zone.id);
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function mobileLayoutCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await seedZone(page);
  let issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('mobile home layout issues: ' + issues.join(' | '));

  await page.click('.zone-card');
  await page.waitForSelector('.level-card');
  issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('mobile zone layout issues: ' + issues.join(' | '));

  const clickable = await page.$$('.level-node-wrap:not(.locked)');
  await clickable[0].click();
  await page.waitForSelector('.quiz-option');
  issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('mobile learn layout issues: ' + issues.join(' | '));
  await context.close();
}

async function desktopLayoutCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await seedZone(page);
  await page.waitForSelector('.desktop-hero');
  let issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('desktop home layout issues: ' + issues.join(' | '));

  await page.click('.zone-card');
  await page.waitForSelector('.level-card');
  issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('desktop zone layout issues: ' + issues.join(' | '));

  await page.click('.sidebar-item[data-nav="settings"]');
  await page.waitForSelector('#btn-export-backup');
  await page.waitForSelector('#btn-choose-backup-dir');
  await page.waitForSelector('#btn-save-speed-tiers');
  issues = await collectLayoutIssues(page);
  if (issues.length) throw new Error('desktop settings layout issues: ' + issues.join(' | '));
  await context.close();
}

async function toastAutoHideCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => Toast.show('自动消失测试', 'success'));
  await page.waitForSelector('.toast-global.show');
  await page.waitForTimeout(3500);
  const stillVisible = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return el.classList.contains('show') || getComputedStyle(el).opacity !== '0';
  });
  if (stillVisible) throw new Error('toast did not auto hide after 3 seconds');
  await context.close();
}

async function offlineCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-new-zone', { timeout: 10000 });
  const ok = await page.evaluate(() => !!document.getElementById('btn-new-zone'));
  if (!ok) throw new Error('offline reload did not render');
  await context.close();
}

async function exportDownloadCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await seedZone(page);
  await page.click('.sidebar-item[data-nav="settings"]');
  await page.waitForSelector('#btn-export-backup');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith('.zip')) {
    throw new Error('export filename is not zip: ' + download.suggestedFilename());
  }
  const tmp = path.join(require('node:os').tmpdir(), 'ai-learn-export-smoke.zip');
  await download.saveAs(tmp);
  const size = fs.statSync(tmp).size;
  if (size < 200) throw new Error('export zip too small: ' + size);
  const zip = await requireFromRuntime(
    'C:/Users/29137/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip'
  ).loadAsync(fs.readFileSync(tmp));
  if (!zip.file('manifest.json') || !zip.file('data.json')) {
    throw new Error('export zip missing manifest/data');
  }
  fs.unlinkSync(tmp);
  await context.close();
}

async function sampleImportCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#btn-settings');
  await page.waitForSelector('#btn-import-backup');
  const sample = path.join(__dirname, '..', 'samples', '示例学习区.zip');
  await page.setInputFiles('#import-file-input', sample);
  await page.waitForSelector('#modal-confirm');
  await page.click('#modal-confirm');
  await page.waitForSelector('.zone-card', { timeout: 15000 });
  const name = await page.textContent('.zone-card-name');
  if (!name.includes('示例学习区')) throw new Error('sample import zone missing: ' + name);
  await page.click('.zone-card');
  await page.waitForSelector('.card-item');
  const cardCount = await page.$$eval('.card-item', (els) => els.length);
  if (cardCount < 3) throw new Error('sample import cards missing: ' + cardCount);
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await mobileLayoutCheck(browser);
    await desktopLayoutCheck(browser);
    await toastAutoHideCheck(browser);
    await offlineCheck(browser);
    await exportDownloadCheck(browser);
    await sampleImportCheck(browser);
    console.log('E2E verify passed');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
