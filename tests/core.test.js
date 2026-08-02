const test = require('node:test');
const assert = require('node:assert');
const MemoryDB = require('./memory-db.js');
const LocalCore = require('../app/js/local/core.js');

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr, days) {
  const p = dateStr.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function makeCore() {
  return LocalCore.create(new MemoryDB());
}

async function addFile(core, zoneId, filename = 'note.txt', content = 'Python 基础内容\n函数与类') {
  return core.addFile(zoneId, { filename, content });
}

async function addCard(core, zoneId, title, answer = 'A', extra = {}) {
  const files = await core.getZoneSourceFiles(zoneId);
  if (!files.length) await addFile(core, zoneId);
  const ok = await core.generateCard(
    zoneId,
    { title, block_name: extra.block_name || '', difficulty: extra.difficulty || '中' },
    {
      question: extra.question || title + '题干',
      option_a: 'A选项',
      option_b: 'B选项',
      option_c: 'C选项',
      option_d: 'D选项',
      answer,
      explanation: extra.explanation || '解析',
      label: extra.label || '常考'
    },
    0
  );
  assert.ok(ok, `card ${title} should be generated`);
  const cards = await core.listCards(zoneId);
  return cards.cards.find((c) => c.title === title).id;
}

test('create zone, upload file and complete today queue', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone('测试学习区')).id;
  await addCard(core, zoneId, '知识点一');
  await addCard(core, zoneId, '知识点二');

  let today = await core.getToday(zoneId);
  assert.strictEqual(today.daily_limit, 5);
  assert.strictEqual(today.pending.length, 2);

  const first = today.pending[0];
  let result = await core.submitAnswer(first.card_id, { option: first.answer });
  assert.strictEqual(result.correct, true);

  today = await core.getToday(zoneId);
  assert.strictEqual(today.pending.length, 1);
  const second = today.pending[0];
  result = await core.submitAnswer(second.card_id, { option: second.answer });
  assert.strictEqual(result.correct, true);

  today = await core.getToday(zoneId);
  assert.strictEqual(today.completed, true);
  assert.strictEqual(today.pending.length, 0);
});

test('wrong three times in one day marks card as 重点复习', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '错题卡', 'A');

  for (let i = 0; i < 3; i++) {
    const today = await core.getToday(zoneId);
    const card = today.pending[0];
    const wrong = card.answer === 'B' ? 'C' : 'B';
    const result = await core.submitAnswer(cardId, { option: wrong });
    assert.strictEqual(result.correct, false);
  }

  const cards = await core.listCards(zoneId);
  assert.strictEqual(cards.cards[0].status, '重点复习');

  const today = await core.getToday(zoneId);
  assert.strictEqual(today.completed, false);
  assert.strictEqual(today.pending.length, 1);
  assert.strictEqual(today.pending[0].card_id, cardId);
});

test('duplicate answer is rejected', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '重复提交卡');
  const today = await core.getToday(zoneId);
  const card = today.pending[0];
  const ok = await core.submitAnswer(cardId, { option: card.answer });
  assert.strictEqual(ok.correct, true);
  await assert.rejects(
    core.submitAnswer(cardId, { option: card.answer }),
    (err) => err.code === 4090
  );
});

test('correct answer schedules Ebbinghaus review dates', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '复习卡');
  const today = await core.getToday(zoneId);
  await core.submitAnswer(cardId, { option: today.pending[0].answer });
  const { reviews } = await core.getReviewSchedule(zoneId);
  const dates = reviews.map((r) => r.review_date).sort();
  const expected = [1, 2, 4, 7, 15].map((d) => addDays(todayStr(), d)).sort();
  assert.deepStrictEqual(dates, expected);
});

test('level layout bounds and relayout', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await core.updateZoneSettings(zoneId, { daily_card_limit: 5 });
  for (let i = 0; i < 20; i++) await addCard(core, zoneId, `知识点${i + 1}`);

  const bounds = await core.computeLevelBounds(zoneId);
  assert.ok(bounds.lower >= 4);
  assert.ok(bounds.upper >= bounds.lower);
  assert.ok(bounds.recommended >= bounds.lower && bounds.recommended <= bounds.upper);

  await core.relayoutLevels(zoneId, 7);
  const progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.total_levels, 7);
  assert.strictEqual(progress.new_levels, 4);
  assert.strictEqual(progress.review_levels, 3);
  assert.deepStrictEqual(
    progress.levels.map((l) => l.level_type),
    ['新学', '新学', '新学', '新学', '复习', '复习', '复习']
  );

  await assert.rejects(
    core.relayoutLevels(zoneId, 3),
    (err) => err.code === 4007
  );
});

test('batch delete preserves completed levels and cleans references', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await core.updateZoneSettings(zoneId, { daily_card_limit: 2 });
  const cardIds = [];
  for (let i = 0; i < 4; i++) cardIds.push(await addCard(core, zoneId, `卡${i + 1}`));

  for (let i = 0; i < 2; i++) {
    const today = await core.getToday(zoneId);
    const card = today.pending[0];
    await core.submitAnswer(card.card_id, { option: card.answer });
  }

  let progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.completed_levels, 1);

  await core.batchDeleteCards([cardIds[0]]);
  progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.completed_levels, 1);

  await core.batchDeleteCards([cardIds[1]]);
  progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.completed_levels, 0);
});

test('batch review adds cards to today queue', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '加入复习卡');
  const result = await core.batchReviewCards([cardId]);
  assert.strictEqual(result.added, 1);
  const today = await core.getToday(zoneId);
  assert.ok(today.pending.some((c) => c.card_id === cardId));
  const card = today.pending.find((c) => c.card_id === cardId);
  await core.submitAnswer(cardId, { option: card.answer });
  const cards = await core.listCards(zoneId);
  assert.strictEqual(cards.cards[0].status, '成功');
});

test('wrong collection and wrong practice flow', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '错题集卡片');
  let today = await core.getToday(zoneId);
  let card = today.pending[0];
  const wrong = card.answer === 'B' ? 'C' : 'B';
  await core.submitAnswer(cardId, { option: wrong });

  let wrongCards = await core.getWrongCards(zoneId);
  assert.strictEqual(wrongCards.wrong_cards.length, 1);
  assert.strictEqual(wrongCards.wrong_cards[0].wrong_times, 1);

  today = await core.getToday(zoneId);
  card = today.pending[0];
  await core.submitAnswer(cardId, { option: card.answer });

  const added = await core.addWrongPractice(zoneId);
  assert.strictEqual(added.added, 1);
  today = await core.getToday(zoneId);
  assert.ok(today.pending.some((c) => c.card_id === cardId));
});

test('standalone wrong practice returns next shuffled options', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '错题单独复习卡');
  let today = await core.getToday(zoneId);
  let card = today.pending[0];
  let wrong = card.answer === 'B' ? 'C' : 'B';
  await core.submitAnswer(cardId, { option: wrong });
  today = await core.getToday(zoneId);
  card = today.pending[0];
  await core.submitAnswer(cardId, { option: card.answer });

  const practice = await core.getWrongPractice(zoneId);
  assert.strictEqual(practice.cards.length, 1);
  const practiceCard = practice.cards[0];
  wrong = practiceCard.answer === 'B' ? 'C' : 'B';
  const failed = await core.submitAnswer(cardId, { option: wrong, mode: 'wrong' });
  assert.strictEqual(failed.correct, false);
  assert.ok(failed.next_options);
  assert.ok(failed.next_answer);

  const ok = await core.submitAnswer(cardId, { option: failed.next_answer, mode: 'wrong' });
  assert.strictEqual(ok.correct, true);
});

test('zone completes when all cards are done', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone('唯一知识点区')).id;
  const cardId = await addCard(core, zoneId, '唯一知识点');
  const today = await core.getToday(zoneId);
  await core.submitAnswer(cardId, { option: today.pending[0].answer });
  const detail = await core.getZoneDetail(zoneId);
  assert.strictEqual(detail.zone.status, '已完成');
});

test('settings, providers and key isolation', async () => {
  const core = makeCore();
  await core.updateSettings({ nickname: '小明', daily_card_limit: 8, ai_api_key: 'sk-abcdefgh1234' });
  const settings = await core.getSettings();
  assert.strictEqual(settings.nickname, '小明');
  assert.strictEqual(settings.daily_card_limit, 8);
  assert.strictEqual(settings.ai_api_key_configured, true);
  assert.strictEqual(settings.ai_api_key_masked, '****1234');

  const providers = await core.listProviders();
  assert.strictEqual(providers.providers.length, 1);
  assert.strictEqual(providers.providers[0].active, true);
  assert.strictEqual(providers.providers[0].key_configured, true);

  const key = await core.revealProviderKey(providers.providers[0].id);
  assert.strictEqual(key.api_key, 'sk-abcdefgh1234');

  await core.updateProvider(providers.providers[0].id, {
    models: [{ name: '我的模型', model: 'deepseek-chat' }]
  });
  const detail = await core.getProviderDetail(providers.providers[0].id);
  assert.deepStrictEqual(detail.models, [{ name: '我的模型', model: 'deepseek-chat' }]);
});

test('export excludes keys and import restores zones', async () => {
  const core = makeCore();
  await core.updateSettings({ nickname: '导出者', ai_api_key: 'sk-secret-do-not-export' });
  const zoneId = (await core.createZone('备份学习区')).id;
  const cardId = await addCard(core, zoneId, '卡片一');
  await addCard(core, zoneId, '卡片二');
  const today = await core.getToday(zoneId);
  const target = today.pending.find((c) => c.card_id === cardId);
  await core.submitAnswer(target.card_id, { option: target.answer });

  const data = await core.collectExportData();
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('sk-secret-do-not-export'));
  assert.ok(!serialized.includes('api_key'));
  assert.strictEqual(data.zones.length, 1);

  const fresh = makeCore();
  const filesMap = {};
  data.files.forEach((f) => {
    filesMap[f.id] = f.content;
  });
  const result = await fresh.importData(data, filesMap, { conflictMode: 'skip', preserveProgress: true });
  assert.strictEqual(result.imported_zones, 1);
  assert.strictEqual(result.cards_imported, 2);

  const zones = await fresh.listZones();
  assert.strictEqual(zones.zones.length, 1);
  assert.strictEqual(zones.zones[0].name, '备份学习区');
  const cards = await fresh.listCards(zones.zones[0].id);
  assert.strictEqual(cards.cards.length, 2);
  assert.strictEqual(cards.cards.find((c) => c.title === '卡片一').status, '成功');
});

test('import without progress resets cards to 待学', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone('重学学习区')).id;
  const cardId = await addCard(core, zoneId, '重学卡');
  const today = await core.getToday(zoneId);
  await core.submitAnswer(cardId, { option: today.pending[0].answer });
  const data = await core.collectExportData();

  const fresh = makeCore();
  const filesMap = {};
  data.files.forEach((f) => {
    filesMap[f.id] = f.content;
  });
  await fresh.importData(data, filesMap, { conflictMode: 'skip', preserveProgress: false });
  const zones = await fresh.listZones();
  const cards = await fresh.listCards(zones.zones[0].id);
  assert.strictEqual(cards.cards[0].status, '待学');
  assert.strictEqual(cards.cards[0].wrong_count, 0);
});

test('zone daily limit change regroups levels without reset', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await core.updateZoneSettings(zoneId, { daily_card_limit: 2 });
  for (let i = 0; i < 6; i++) await addCard(core, zoneId, `卡${i + 1}`);
  let progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.new_levels, 3);
  assert.deepStrictEqual(
    progress.levels.filter((l) => l.level_type === '新学').map((l) => l.card_count),
    [2, 2, 2]
  );

  await core.updateZoneSettings(zoneId, { daily_card_limit: 3 });
  progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.daily_limit, 3);
  assert.strictEqual(progress.layout.lower, 2);
  assert.strictEqual(progress.new_levels, 3);

  await core.updateZoneSettings(zoneId, { sort_mode: 'block' });
  progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.new_levels, 2);
  assert.deepStrictEqual(
    progress.levels.filter((l) => l.level_type === '新学').map((l) => l.card_count),
    [3, 3]
  );
});

test('level replay does not change card status or review schedule', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '重开卡');
  const today = await core.getToday(zoneId);
  const target = today.pending.find((c) => c.card_id === cardId);
  await core.submitAnswer(target.card_id, { option: target.answer });

  const before = await core.getReviewSchedule(zoneId);
  const started = await core.startLevel(zoneId, 1);
  assert.strictEqual(started.mode, 'replay');
  assert.ok(started.cards.length >= 1);
  const replayCard = started.cards[0];
  const result = await core.submitAnswer(replayCard.card_id, {
    option: replayCard.answer,
    mode: 'replay',
    level_no: 1
  });
  assert.strictEqual(result.correct, true);
  const cards = await core.listCards(zoneId);
  assert.strictEqual(cards.cards[0].status, '成功');
  const after = await core.getReviewSchedule(zoneId);
  assert.strictEqual(after.reviews.length, before.reviews.length);
});

test('batch delete works across multiple zones', async () => {
  const core = makeCore();
  const z1 = (await core.createZone('区一')).id;
  const z2 = (await core.createZone('区二')).id;
  const c1 = await addCard(core, z1, '卡片一');
  const c2 = await addCard(core, z2, '卡片二');
  const result = await core.batchDeleteCards([c1, c2]);
  assert.strictEqual(result.deleted, 2);
  assert.strictEqual((await core.listCards(z1)).cards.length, 0);
  assert.strictEqual((await core.listCards(z2)).cards.length, 0);
});

test('import conflict modes skip, keep_both and overwrite', async () => {
  const source = makeCore();
  const sourceZone = (await source.createZone('同名区')).id;
  await addCard(source, sourceZone, '源卡片');
  const data = await source.collectExportData();
  const filesMap = {};
  data.files.forEach((f) => {
    filesMap[f.id] = f.content;
  });

  const skipCore = makeCore();
  await skipCore.createZone('同名区');
  const skip = await skipCore.importData(data, filesMap, { conflictMode: 'skip', preserveProgress: false });
  assert.strictEqual(skip.imported_zones, 0);
  assert.deepStrictEqual(skip.skipped_zones, ['同名区']);
  assert.strictEqual((await skipCore.listZones()).zones.length, 1);

  const bothCore = makeCore();
  await bothCore.createZone('同名区');
  const both = await bothCore.importData(data, filesMap, { conflictMode: 'keep_both', preserveProgress: false });
  assert.strictEqual(both.imported_zones, 1);
  const bothZones = (await bothCore.listZones()).zones;
  assert.strictEqual(bothZones.length, 2);
  assert.ok(bothZones.some((z) => z.name.includes('导入')));

  const overwriteCore = makeCore();
  await overwriteCore.createZone('同名区');
  const overwrite = await overwriteCore.importData(data, filesMap, { conflictMode: 'overwrite', preserveProgress: false });
  assert.strictEqual(overwrite.imported_zones, 1);
  const zones = (await overwriteCore.listZones()).zones;
  assert.strictEqual(zones.length, 1);
  assert.strictEqual((await overwriteCore.listCards(zones[0].id)).cards.length, 1);
});

test('provider activation keeps exactly one active provider', async () => {
  const core = makeCore();
  const first = (await core.createProvider({ provider_id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com' })).id;
  const second = (await core.createProvider({ provider_id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1' })).id;
  let providers = await core.listProviders();
  assert.strictEqual(providers.providers.filter((p) => p.active).length, 1);

  await core.activateProvider(second);
  providers = await core.listProviders();
  const active = providers.providers.filter((p) => p.active);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, second);

  await core.deleteProvider(second);
  providers = await core.listProviders();
  assert.strictEqual(providers.providers.length, 1);
  assert.strictEqual(providers.providers[0].active, true);
  assert.strictEqual(providers.providers[0].id, first);
});

test('checkin, streak and progress update after completing level', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  const cardId = await addCard(core, zoneId, '打卡卡');
  let progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.checked_today, false);
  const today = await core.getToday(zoneId);
  const target = today.pending.find((c) => c.card_id === cardId);
  await core.submitAnswer(target.card_id, { option: target.answer });
  progress = await core.getProgress(zoneId);
  assert.strictEqual(progress.checked_today, true);
  assert.strictEqual(progress.today_done, true);
  assert.ok(progress.streak >= 1);
  assert.ok(progress.completed_levels >= 1);
  assert.ok(progress.week.some((w) => w.checked));
});

test('generateCard creates a paired memory card for every quiz card', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await addCard(core, zoneId, '成对知识点', 'A', {
    difficulty: '难',
    block_name: '基础',
    explanation: '成对解析'
  });
  const memory = await core.memoryCardsByZone(zoneId);
  assert.strictEqual(memory.length, 1);
  assert.strictEqual(memory[0].title, '成对知识点');
  assert.strictEqual(memory[0].back_detail, '成对解析');
  assert.strictEqual(memory[0].difficulty, '难');
  assert.strictEqual(memory[0].block_name, '基础');
  const quiz = (await core.listCards(zoneId)).cards[0];
  assert.strictEqual(quiz.id, memory[0].pair_card_id);
  const storedQuiz = await core.listLibraryCards(zoneId, 'quiz');
  assert.strictEqual(storedQuiz.cards[0].pair_id, memory[0].id);
});

test('library list supports favorite pinning and keyword search', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await addCard(core, zoneId, '变量作用域');
  await addCard(core, zoneId, '闭包与函数');

  let library = await core.listLibraryCards(zoneId, 'quiz');
  assert.strictEqual(library.cards.length, 2);
  assert.strictEqual(library.cards.every((c) => c.favorite === 0), true);

  const second = library.cards[1];
  await core.toggleFavorite(zoneId, 'quiz', second.id);
  library = await core.listLibraryCards(zoneId, 'quiz');
  assert.strictEqual(library.cards[0].id, second.id);
  assert.strictEqual(library.cards[0].favorite, 1);

  const filtered = await core.listLibraryCards(zoneId, 'quiz', '闭包');
  assert.strictEqual(filtered.cards.length, 1);
  assert.strictEqual(filtered.cards[0].title, '闭包与函数');

  const favorites = await core.listLibraryCards(zoneId, 'favorites');
  assert.strictEqual(favorites.cards.length, 2);
  assert.strictEqual(favorites.cards.some((c) => c.title === '闭包与函数'), true);
});

test('library delete removes current kind only unless pair is requested', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone()).id;
  await addCard(core, zoneId, '待删知识点');
  const quiz = (await core.listLibraryCards(zoneId, 'quiz')).cards[0];
  const memory = (await core.listLibraryCards(zoneId, 'memory')).cards[0];

  let result = await core.deleteLibraryCards(zoneId, 'quiz', [quiz.id], false);
  assert.strictEqual(result.deleted, 1);
  assert.strictEqual((await core.listLibraryCards(zoneId, 'quiz')).cards.length, 0);
  assert.strictEqual((await core.listLibraryCards(zoneId, 'memory')).cards.length, 1);

  result = await core.deleteLibraryCards(zoneId, 'memory', [memory.id], true);
  assert.strictEqual(result.deleted, 1);
  assert.strictEqual((await core.listLibraryCards(zoneId, 'memory')).cards.length, 0);
});

test('memory mode levels reuse the same path rules with flip-card answers', async () => {
  const core = makeCore();
  const zoneId = (await core.createZone('记忆模式区')).id;
  await addCard(core, zoneId, '记忆点一');
  await addCard(core, zoneId, '记忆点二');
  await core.rebuildZoneLevels(zoneId, null, false, 'quiz');

  await core.updateZoneSettings(zoneId, { study_mode: 'memory' });
  const today = await core.getToday(zoneId);
  assert.strictEqual(today.kind, 'memory');
  assert.strictEqual(today.pending.length, 2);
  assert.ok(today.pending.every((c) => c.kind === 'memory'));

  for (const card of today.pending) {
    const ok = await core.submitMemoryAnswer(card.card_id, { known: true, mode: 'daily', level_no: today.level_no });
    assert.strictEqual(ok.correct, true);
  }

  const doneToday = await core.getToday(zoneId);
  assert.strictEqual(doneToday.completed, true);
  const memory = await core.listLibraryCards(zoneId, 'memory');
  assert.strictEqual(memory.cards.every((c) => c.status === '成功'), true);

  await core.updateZoneSettings(zoneId, { study_mode: 'quiz' });
  const quizProgress = await core.getProgress(zoneId);
  assert.strictEqual(quizProgress.study_mode, 'quiz');
  assert.ok(quizProgress.levels.length >= 1);
});

test('export format v2 restores memory cards and study mode', async () => {
  const core = makeCore();
  await core.updateSettings({ nickname: '导出记忆' });
  const zoneId = (await core.createZone('记忆备份区')).id;
  await addCard(core, zoneId, '备份记忆点');
  await core.updateZoneSettings(zoneId, { study_mode: 'memory' });
  const data = await core.collectExportData();
  assert.strictEqual(data.memory_cards.length, 1);

  const fresh = makeCore();
  const filesMap = {};
  data.files.forEach((f) => {
    filesMap[f.id] = f.content;
  });
  const result = await fresh.importData(data, filesMap, { conflictMode: 'skip', preserveProgress: true });
  assert.strictEqual(result.imported_zones, 1);
  const zones = await fresh.listZones();
  const importedId = zones.zones[0].id;
  const detail = await fresh.getZoneDetail(importedId);
  assert.strictEqual(detail.zone.study_mode, 'memory');
  assert.strictEqual((await fresh.listLibraryCards(importedId, 'quiz')).cards.length, 1);
  assert.strictEqual((await fresh.listLibraryCards(importedId, 'memory')).cards.length, 1);
});
