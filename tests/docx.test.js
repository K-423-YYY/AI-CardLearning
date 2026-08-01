const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromRuntime = createRequire(path.join(__dirname, '..', 'app', 'x.js'));
const JSZip = requireFromRuntime(
  'C:/Users/29137/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip'
);
global.JSZip = JSZip;
const LocalDocx = require('../app/js/local/docx.js');

test('docx parser extracts paragraph text', async () => {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    '<w:document><w:body><w:p><w:r><w:t>第一段内容</w:t></w:r></w:p><w:p><w:r><w:t>第二段内容</w:t></w:r></w:p></w:body></w:document>'
  );
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  const text = await LocalDocx.extractText(buffer);
  assert.ok(text.includes('第一段内容'));
  assert.ok(text.includes('第二段内容'));
});
