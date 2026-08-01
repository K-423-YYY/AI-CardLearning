const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const requireFromRuntime = createRequire(path.join(__dirname, '..', 'app', 'x.js'));
const { chromium } = requireFromRuntime(
  'C:/Users/29137/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const BASE = 'http://127.0.0.1:8765/index.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');

async function newPage(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      errors.push('console: ' + msg.text());
    }
  });
  page.__errors = errors;
  return page;
}

async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false });
  console.log('screenshot saved:', name);
}

async function mobileFlow(browser) {
  const page = await newPage(browser, 390, 844);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-new-zone');

  const topbarHidden = await page.evaluate(() => {
    const el = document.getElementById('desktop-topbar');
    return getComputedStyle(el).display === 'none';
  });
  if (!topbarHidden) throw new Error('mobile should hide desktop topbar');
  await shot(page, 'mobile-home.png');

  await page.click('#btn-new-zone');
  await page.fill('#zone-name-input', 'Python 基础');
  await page.click('#modal-confirm');
  await page.waitForSelector('.zone-card');
  await page.click('.zone-card');
  await page.waitForSelector('#btn-upload');

  await page.click('#btn-upload');
  await page.setInputFiles('#upload-file-input', {
    name: 'python-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Python 变量与类型\n函数定义\n类与对象\n', 'utf8')
  });
  await page.click('#btn-upload-confirm');
  await page.waitForSelector('#modal-confirm');
  await page.click('#modal-confirm');
  await page.waitForSelector('.ai-file-check:checked');
  await page.click('#btn-back-ai');
  await page.waitForSelector('.file-item');

  const zoneId = await page.evaluate(() => parseInt(location.hash.split('/')[1], 10));
  await page.evaluate(async (zid) => {
    const points = [
      { title: '变量与类型', block_name: '基础语法', difficulty: '易' },
      { title: '函数定义', block_name: '基础语法', difficulty: '中' },
      { title: '类与对象', block_name: '面向对象', difficulty: '难' }
    ];
    for (let i = 0; i < points.length; i++) {
      await LocalCoreInstance.generateCard(zid, points[i], {
        question: points[i].title + ' 的题干？',
        option_a: '选项A',
        option_b: '选项B',
        option_c: '选项C',
        option_d: '选项D',
        answer: 'A',
        explanation: '这是解析',
        label: '常考'
      }, i + 1);
    }
    await LocalCoreInstance.rebuildZoneLevels(zid);
  }, zoneId);

  await page.click('#btn-back-home');
  await page.click('.zone-card');
  await page.waitForSelector('.level-node-wrap');
  const clickable = await page.$$('.level-node-wrap:not(.locked)');
  if (!clickable.length) throw new Error('no clickable level node');
  await clickable[0].click();
  await page.waitForSelector('.quiz-option');
  await shot(page, 'mobile-learn.png');

  const option = await page.$('.quiz-option');
  await option.click();
  await page.waitForSelector('.quiz-result.show');
  const resultText = await page.textContent('#quiz-result');
  if (!resultText) throw new Error('quiz result missing');
  await shot(page, 'mobile-answer.png');

  if (page.__errors.length) throw new Error('mobile console errors: ' + page.__errors.join(' | '));
  await page.close();
}

async function desktopFlow(browser) {
  const page = await newPage(browser, 1440, 900);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const zone = await LocalCoreInstance.createZone('桌面端学习区');
    await LocalCoreInstance.addFile(zone.id, { filename: 'desktop.txt', content: '桌面端学习内容' });
    await LocalCoreInstance.generateCard(zone.id, { title: '桌面卡片', block_name: '桌面', difficulty: '中' }, {
      question: '桌面端题干？',
      option_a: '选项A',
      option_b: '选项B',
      option_c: '选项C',
      option_d: '选项D',
      answer: 'A',
      explanation: '解析',
      label: '常考'
    }, 1);
    await LocalCoreInstance.rebuildZoneLevels(zone.id);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.desktop-hero');
  await page.waitForSelector('.zone-card');

  const sidebarVisible = await page.evaluate(() => {
    const el = document.getElementById('sidebar');
    return getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 200;
  });
  if (!sidebarVisible) throw new Error('desktop sidebar should be visible');
  const heroVisible = await page.evaluate(() => {
    const el = document.getElementById('desktop-hero');
    return getComputedStyle(el).display === 'grid';
  });
  if (!heroVisible) throw new Error('desktop hero should be visible');
  await shot(page, 'desktop-home.png');

  await page.click('.zone-card');
  await page.waitForSelector('.level-card');
  const title = await page.textContent('#desktop-title');
  if (!title.includes('学习区')) throw new Error('desktop title wrong: ' + title);
  await shot(page, 'desktop-zone.png');

  await page.click('.sidebar-item[data-nav="settings"]');
  await page.waitForSelector('#btn-export-backup');
  await shot(page, 'desktop-settings.png');

  if (page.__errors.length) throw new Error('desktop console errors: ' + page.__errors.join(' | '));
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await mobileFlow(browser);
    await desktopFlow(browser);
    console.log('E2E smoke passed');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
