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
  const db = new MemoryDB();
  const core = LocalCore.create(db);
  const zone = await core.createZone('AI 本地测试');
  return { core, zoneId: zone.id, db };
}

test('local AI analysis filters files and card generation batches', async () => {
  const { core, zoneId, db } = await makeCore();
  const fileA = await core.addFile(zoneId, { filename: 'a.txt', content: 'AAA 内容' });
  const fileB = await core.addFile(zoneId, { filename: 'b.txt', content: 'BBB 内容' });
  const ai = LocalAI.create(core);
  const originalFetch = global.fetch;
  await core.updateSettings({ ai_api_key: 'local-test-key-123456' });
  await core.updateSettings({
    speed_tier2_bytes: 1024,
    speed_tier3_bytes: 2048,
    speed_tier4_bytes: 4096
  });
  const providers = await core.listProviders();
  await core.updateProvider(providers.providers[0].id, { models: [{ model: 'test-model' }] });
  const speedProfile = ai.resolveSpeedProfile(await core.getSettings(), 2048);
  assert.strictEqual(speedProfile.multiplier, 10);

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const user = body.messages[1].content;
    const userText = Array.isArray(user)
      ? (user.find((part) => part.type === 'text') || {}).text || ''
      : user;
    if (userText.includes('这张图片')) {
      return fakeResponse({ blocks: [{ name: '图片区', points: [{ title: '图片知识点', difficulty: '中' }] }] });
    }
    if (userText.includes('选择题试卷')) {
      return fakeResponse({
        exam_questions: [
          {
            type: 'choice',
            question: '下列哪项正确？',
            options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'],
            answer: 'B',
            explanation: '乙正确',
            difficulty: '中'
          }
        ]
      });
    }
    if (userText.includes('AAA')) {
      return fakeResponse({ blocks: [{ name: 'A 区', points: [{ title: 'A 点', difficulty: '易' }] }] });
    }
    if (userText.includes('BBB')) {
      return fakeResponse({ blocks: [{ name: 'B 区', points: [{ title: 'B 点', difficulty: '难' }] }] });
    }
    if (userText.includes('请按顺序')) {
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
    if (userText.startsWith('知识点：')) {
      return fakeResponse({
        question: '题干',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        explanation: '解析',
        label: '常考'
      });
    }
    throw new Error('unexpected AI request');
  };

  try {
    const points = await ai.analyzeZone(zoneId, null, [fileA.id]);
    assert.strictEqual(points.length, 1);
    assert.strictEqual(points[0].title, 'A 点');
    assert.strictEqual(points[0].file_id, fileA.id);

    const examFile = await core.addFile(zoneId, { filename: 'exam.txt', content: '选择题试卷内容' });
    const examPoints = await ai.analyzeZone(zoneId, null, [examFile.id]);
    assert.strictEqual(examPoints.length, 1);
    assert.strictEqual(examPoints[0].exam_type, 'choice');
    assert.deepStrictEqual(examPoints[0].exam_options, ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁']);
    const examResult = await ai.generateCards(zoneId, [examPoints[0]], null);
    assert.strictEqual(examResult.generated, 1);
    const examCards = (await db.all('cards')).filter((card) => card.title === '下列哪项正确？');
    assert.strictEqual(examCards.length, 1);
    const examOptions = [examCards[0].option_a, examCards[0].option_b, examCards[0].option_c, examCards[0].option_d];
    assert.deepStrictEqual(examOptions.slice().sort(), ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'].sort());
    assert.strictEqual(examCards[0].answer, 'ABCD'[examOptions.indexOf('B. 乙')]);

    const imageFile = await core.addFile(zoneId, {
      filename: 'note.png',
      content: 'data:image/png;base64,AAAA',
      kind: 'image',
      mime_type: 'image/png'
    });
    const imagePoints = await ai.analyzeZone(zoneId, null, [imageFile.id]);
    assert.strictEqual(imagePoints.length, 1);
    assert.strictEqual(imagePoints[0].title, '图片知识点');
    assert.strictEqual(imagePoints[0].file_id, imageFile.id);

    const result = await ai.generateCards(
      zoneId,
      [1, 2, 3].map((n) => ({ title: `知识点 ${n}`, description: '', block_name: '测试', difficulty: '中', file_id: fileB.id })),
      null
    );
    assert.strictEqual(result.generated, 3);
    const rawCards = await db.all('cards');
    assert.ok(rawCards.some((card) => card.title.startsWith('知识点 ')));
    const listed = await core.listCards(zoneId);
    assert.strictEqual(listed.cards.length, 4);
    const generatedCards = listed.cards.filter((card) => card.title.startsWith('知识点 '));
    assert.strictEqual(generatedCards.length, 3);
    assert.ok(generatedCards.every((card) => card.filename === 'b.txt'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('refine pipeline returns scope, extensions and decomposed tree', async () => {
  const { core, zoneId } = await makeCore();
  await core.addFile(zoneId, { filename: 'refine.txt', content: '精炼内容' });
  const ai = LocalAI.create(core);
  const originalFetch = global.fetch;
  await core.updateSettings({ ai_api_key: 'local-test-key-123456' });
  const providers = await core.listProviders();
  await core.updateProvider(providers.providers[0].id, { models: [{ model: 'test-model' }] });

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const user = body.messages[1].content;
    const text = Array.isArray(user)
      ? (user.find((part) => part.type === 'text') || {}).text || ''
      : user;
    if (text.includes('最多补充')) {
      return fakeResponse({
        extensions: [
          {
            category: '实际应用/案例',
            title: '精炼应用案例',
            content: '案例内容',
            reason: '帮助实际应用'
          }
        ]
      });
    }
    if (text.includes('区块：')) {
      return fakeResponse({
        tree: [
          {
            name: '大结构A',
            structures: [
              {
                name: '结构A',
                blocks: [
                  {
                    name: '区块A',
                    points: [{ title: '原子点', description: '原子说明', difficulty: '易' }]
                  }
                ]
              }
            ]
          }
        ]
      });
    }
    if (text.startsWith('知识点：')) {
      return fakeResponse({
        question: '题干',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        explanation: '解析',
        label: '常考'
      });
    }
    return fakeResponse({
      scope: '范围说明',
      outline: ['1. 主题', '1.1 子主题'],
      issues: [
        {
          source: '原文',
          issue: '疑似错误',
          reason: '理由',
          suggestion: '建议'
        }
      ],
      blocks: [
        {
          name: '区块',
          points: [{ title: '精炼点', description: '说明', difficulty: '中' }]
        }
      ],
      exam_questions: []
    });
  };

  try {
    const stage1 = await ai.refineAnalyze(zoneId, null, []);
    assert.strictEqual(stage1.scope, '范围说明');
    assert.deepStrictEqual(stage1.outline, ['1. 主题', '1.1 子主题']);
    assert.strictEqual(stage1.issues.length, 1);
    assert.strictEqual(stage1.knowledge_points.length, 1);

    const stage2 = await ai.refineExtend(zoneId, stage1.knowledge_points, { max_items: 3 });
    assert.strictEqual(stage2.extensions.length, 1);
    assert.strictEqual(stage2.extensions[0].category, '实际应用/案例');
    assert.strictEqual(stage2.extensions[0].title, '精炼应用案例');

    const mergedPoints = [
      ...stage1.knowledge_points,
      ...stage2.extensions.map((e) => ({
        title: e.title,
        description: e.content,
        block_name: e.category
      }))
    ];
    const stage3 = await ai.refineDecompose(zoneId, mergedPoints);
    assert.strictEqual(stage3.points.length, 1);
    assert.strictEqual(stage3.points[0].path, '大结构A / 结构A / 区块A');

    const result = await ai.generateCards(zoneId, stage3.points, null);
    assert.strictEqual(result.generated, 1);
    const memory = await core.memoryCardsByZone(zoneId);
    assert.strictEqual(memory.length, 1);
    assert.strictEqual(memory[0].path, '大结构A / 结构A / 区块A');
    assert.strictEqual(memory[0].back_detail, '原子说明');
  } finally {
    global.fetch = originalFetch;
  }
});
