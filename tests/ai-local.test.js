const test = require('node:test');
const assert = require('node:assert');
const MemoryDB = require('./memory-db.js');
const LocalCore = require('../app/js/local/core.js');
const LocalAI = require('../app/js/local/ai.js');

function fakeResponse(payload) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

async function makeCore() {
  const core = LocalCore.create(new MemoryDB());
  const zone = await core.createZone('AI 本地测试');
  return { core, zoneId: zone.id };
}

test('local AI analysis filters files and card generation batches', async () => {
  const { core, zoneId } = await makeCore();
  const fileA = await core.addFile(zoneId, { filename: 'a.txt', content: 'AAA 内容' });
  const fileB = await core.addFile(zoneId, { filename: 'b.txt', content: 'BBB 内容' });
  const ai = LocalAI.create(core);
  const originalFetch = global.fetch;
  await core.updateSettings({ ai_api_key: 'local-test-key-123456' });
  const providers = await core.listProviders();
  await core.updateProvider(providers.providers[0].id, { models: [{ model: 'test-model' }] });

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const user = body.messages[1].content;
    if (user.includes('AAA')) {
      return fakeResponse({ blocks: [{ name: 'A 区', points: [{ title: 'A 点', difficulty: '易' }] }] });
    }
    if (user.includes('BBB')) {
      return fakeResponse({ blocks: [{ name: 'B 区', points: [{ title: 'B 点', difficulty: '难' }] }] });
    }
    if (user.includes('请按顺序')) {
      return fakeResponse({
        cards: [1, 2, 3].map((n) => ({
          question: `题干 ${n}`,
          options: ['A', 'B', 'C', 'D'],
          answer: 'A',
          explanation: '解析',
          label: '常考'
        }))
      });
    }
    throw new Error('unexpected AI request');
  };

  try {
    const points = await ai.analyzeZone(zoneId, null, [fileA.id]);
    assert.strictEqual(points.length, 1);
    assert.strictEqual(points[0].title, 'A 点');
    assert.strictEqual(points[0].file_id, fileA.id);

    const result = await ai.generateCards(
      zoneId,
      [1, 2, 3].map((n) => ({ title: `知识点 ${n}`, description: '', block_name: '测试', difficulty: '中', file_id: fileB.id })),
      null
    );
    assert.strictEqual(result.generated, 3);
    const cards = (await core.listCards(zoneId)).cards;
    assert.strictEqual(cards.length, 3);
    assert.ok(cards.every((card) => card.filename === 'b.txt'));
  } finally {
    global.fetch = originalFetch;
  }
});
