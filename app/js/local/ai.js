(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalAI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ANALYZE_SYSTEM =
    '你是学习资料分析助手。请阅读用户上传的文字、Word 文档或图片资料，完整提取全部核心知识点，' +
    '不得遗漏文件中的任何知识点，也不能凭空增加文件里没有的内容。' +
    '把知识点按内容主题分成若干个区块，每个知识点只能属于一个区块。' +
    '如果内容包含选择题或判断题等客观题，请额外输出 "exam_questions" 数组，逐题原样保留题干和选项：{"type": "choice", "question": "原题题干", "options": ["A. 选项", "B. 选项", "C. 选项", "D. 选项"], "answer": "A", "explanation": "解析", "difficulty": "易或中或难"}。判断题 type 为 "judge"，选项为 ["正确", "错误"]。' +
    '计算大题、主观题或普通资料不要输出 exam_questions，按原格式处理。' +
    '只输出一个 JSON 对象，格式：{"blocks": [{"name": "区块名", "points": [{"title": "知识点标题", "description": "一句话说明", "difficulty": "易或中或难"}]}], "exam_questions": [{"type": "choice", "question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "...", "difficulty": "易或中或难"}]}。' +
    '不要输出 JSON 以外的任何文字。';

  const CARD_SYSTEM =
    '你是出题助手。根据给定的知识点生成一道四选一选择题。' +
    '只输出一个 JSON 对象，格式：{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分"}。' +
    'answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。';

  const CARD_BATCH_SYSTEM =
    '你是出题助手。根据给定的多个知识点，为每个知识点生成一道四选一选择题。' +
    '只输出一个 JSON 对象，格式：{"cards": [{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分"}]}。' +
    'cards 的数量必须与提供的知识点数量一致，顺序保持一致。answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。';

  const ANALYZE_CONCURRENCY = 5;
  const GENERATE_CONCURRENCY = 5;
  const CARD_BATCH_SIZE = 5;
  const CHUNK_SIZE = 60000;

  const SPEED_PROFILES = [
    { multiplier: 1, analyzeConcurrency: 1, generateConcurrency: 1, cardBatchSize: 1 },
    { multiplier: 5, analyzeConcurrency: 5, generateConcurrency: 5, cardBatchSize: 5 },
    { multiplier: 10, analyzeConcurrency: 10, generateConcurrency: 10, cardBatchSize: 10 },
    { multiplier: 20, analyzeConcurrency: 20, generateConcurrency: 20, cardBatchSize: 10 }
  ];

  function resolveSpeedProfile(settings, totalBytes) {
    const fallback = (mb, bytes) => bytes || (mb || 1) * 1024 * 1024;
    const t2 = Math.max(1, Number(fallback(settings && settings.speed_tier2_mb, settings && settings.speed_tier2_bytes)) || 1024 * 1024);
    const t3 = Math.max(t2 + 1, Number(fallback(settings && settings.speed_tier3_mb, settings && settings.speed_tier3_bytes)) || 5 * 1024 * 1024);
    const t4 = Math.max(t3 + 1, Number(fallback(settings && settings.speed_tier4_mb, settings && settings.speed_tier4_bytes)) || 20 * 1024 * 1024);
    let profile = SPEED_PROFILES[0];
    if (totalBytes >= t4) profile = SPEED_PROFILES[3];
    else if (totalBytes >= t3) profile = SPEED_PROFILES[2];
    else if (totalBytes >= t2) profile = SPEED_PROFILES[1];
    return profile;
  }

  class AIError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AIError';
    }
  }

  function cleanJson(content) {
    const text = String(content || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fence ? fence[1].trim() : text;
  }

  function normalizeDifficulty(value) {
    const text = String(value || '').trim();
    return text === '易' || text === '中' || text === '难' ? text : '中';
  }

  function hashCode(str) {
    let h = 2166136261;
    for (const ch of String(str || '')) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleWithSeed(list, seedText) {
    const arr = list.slice();
    const rng = mulberry32(hashCode(seedText));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function examCardFromPoint(point, sortOrder) {
    const options = (point.exam_options || []).map((item) => String(item).trim()).filter(Boolean);
    const answerRaw = String(point.exam_answer || '').trim().toUpperCase();
    let answerText = answerRaw;
    if (/^[A-D]$/.test(answerRaw)) {
      answerText = options['ABCD'.indexOf(answerRaw)] || options[0] || answerRaw;
    } else {
      answerText = options.find((option) => String(option).toUpperCase().includes(answerRaw)) || answerRaw;
    }
    const shuffled = shuffleWithSeed(options, `${point.title || point.exam_question}::${point.file_id || ''}::${sortOrder || 0}`);
    const answerLetter = 'ABCD'[shuffled.indexOf(answerText)];
    return {
      question: String(point.exam_question || point.title || ''),
      option_a: shuffled[0] || '',
      option_b: shuffled[1] || '',
      option_c: shuffled[2] || '',
      option_d: shuffled[3] || '',
      answer: answerLetter || 'A',
      explanation: String(point.description || '原卷解析'),
      label: '常考'
    };
  }

  function parseCard(data) {
    const question = String((data && data.question) || '').trim();
    if (!question) throw new AIError('AI 返回的题干为空');
    let options = data && data.options;
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      options = ['option_a', 'option_b', 'option_c', 'option_d'].map((k) => options[k] || '');
    }
    if (!Array.isArray(options) || options.length !== 4 || options.some((o) => !String(o).trim())) {
      throw new AIError('AI 返回的选项不完整');
    }
    const answer = String((data && data.answer) || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(answer)) throw new AIError('AI 返回的答案格式不正确');
    const label = String((data && data.label) || '常考').trim();
    return {
      question,
      option_a: String(options[0]).trim(),
      option_b: String(options[1]).trim(),
      option_c: String(options[2]).trim(),
      option_d: String(options[3]).trim(),
      answer,
      explanation: String((data && data.explanation) || '').trim(),
      label: ['必考', '常考', '加分'].includes(label) ? label : '常考'
    };
  }

  async function chatJson(apiKey, baseUrl, model, messages, timeoutMs) {
    const url = String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    const attempts = [
      { response_format: { type: 'json_object' } },
      {}
    ];
    let lastError = null;
    for (const extra of attempts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            ...extra
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text();
          throw new AIError(`AI 接口返回 ${res.status}：${text.slice(0, 200)}`);
        }
        const payload = await res.json();
        const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
          ? payload.choices[0].message.content
          : '';
        return JSON.parse(cleanJson(content));
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
      }
    }
    throw new AIError(`直连和代理连接均失败，AI 返回内容解析失败，请重试：${lastError && lastError.message ? lastError.message : lastError}`);
  }

  function create(core) {
    function splitText(text, size) {
      const result = [];
      let current = '';
      String(text || '').split('\n').forEach((line) => {
        if (current && current.length + line.length + 1 > size) {
          result.push(current);
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      });
      if (current) result.push(current);
      return result;
    }

    function parseBlocks(data, fileId) {
      const blocks = (data && data.blocks) || [];
      const result = [];
      if (blocks.length === 0 && data && data.knowledge_points) {
        blocks.push({ name: '全部知识点', points: data.knowledge_points });
      }
      blocks.forEach((block) => {
        if (!block || typeof block !== 'object') return;
        const blockName = String(block.name || '').trim() || '未分区';
        (block.points || []).slice(0, 200).forEach((point) => {
          if (point && point.title) {
            result.push({
              title: String(point.title),
              description: String(point.description || ''),
              block_name: blockName,
              difficulty: normalizeDifficulty(point.difficulty),
              file_id: fileId || null
            });
          }
        });
      });
      (data && Array.isArray(data.exam_questions) ? data.exam_questions : []).forEach((question) => {
        if (!question || !question.question) return;
        const options = (question.options || []).map((item) => String(item).trim()).filter(Boolean);
        if (options.length < 2) return;
        result.push({
          title: String(question.question),
          description: String(question.explanation || ''),
          block_name: question.type === 'judge' ? '试卷·判断题' : '试卷·选择题',
          difficulty: normalizeDifficulty(question.difficulty || '中'),
          file_id: fileId || null,
          exam_type: question.type === 'judge' ? 'judge' : 'choice',
          exam_question: String(question.question),
          exam_options: options,
          exam_answer: String(question.answer || '')
        });
      });
      return result;
    }

    async function analyzeZone(zoneId, onProgress, fileIds, profileRef) {
      const config = await core.getActiveAIConfig();
      const files = await core.getZoneSourceFiles(zoneId, fileIds);
      if (!files.length) throw new AIError('学习区还没有文件，请先上传文件');
      const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
      const profile = resolveSpeedProfile(await core.getSettings(), totalBytes);
      const currentProfile = () => (profileRef && profileRef.value) || profile;
      const jobs = [];
      files.forEach((f) => {
        if (f.kind === 'image' || /^data:image\//.test(String(f.content || ''))) {
          jobs.push({ image: String(f.content || ''), filename: f.filename, fileId: f.id });
          return;
        }
        const text = String(f.content || '').slice(0, CHUNK_SIZE);
        const content = `文件《${f.filename}》：\n${text}`;
        splitText(content, CHUNK_SIZE).forEach((chunk) => {
          jobs.push({ chunk, fileId: f.id });
        });
      });
      const analyze = async (job) => {
        const userContent = job.image
          ? [
              {
                type: 'text',
                text: `请分析这张图片《${job.filename}》，提取其中全部核心知识点并按区块整理。`
              },
              { type: 'image_url', image_url: { url: job.image } }
            ]
          : job.chunk;
        const data = await chatJson(config.api_key, config.base_url, config.model, [
          { role: 'system', content: ANALYZE_SYSTEM },
          { role: 'user', content: userContent }
        ]);
        return parseBlocks(data, job.fileId);
      };

      if (jobs.length === 1) {
        const result = await analyze(jobs[0]);
        if (!result.length) throw new AIError('AI 未能识别出知识点，请重试');
        if (onProgress) onProgress(1, 1);
        return result;
      }

      const queue = jobs.slice();
      const merged = new Map();
      const seen = new Set();
      let done = 0;
      let activeWorkers = 0;
      let resolveFinished;
      const finished = new Promise((resolve) => { resolveFinished = resolve; });
      const desired = () => Math.max(1, currentProfile().analyzeConcurrency || 1);
      const maybeFinished = () => {
        if (activeWorkers === 0 && queue.length === 0) resolveFinished();
      };
      const worker = async () => {
        activeWorkers++;
        try {
          while (queue.length) {
            if (activeWorkers > desired()) break;
            const job = queue.shift();
            const points = await analyze(job);
            points.forEach((p) => {
              const key = `${p.block_name}::${p.title}`;
              if (seen.has(key)) return;
              seen.add(key);
              if (!merged.has(p.block_name)) merged.set(p.block_name, []);
              merged.get(p.block_name).push(p);
            });
            done++;
            if (onProgress) onProgress(done, jobs.length);
          }
        } finally {
          activeWorkers--;
          maybeFinished();
        }
      };
      const ensureWorkers = () => {
        while (activeWorkers < Math.min(desired(), jobs.length) && queue.length) {
          worker();
        }
        maybeFinished();
      };
      ensureWorkers();
      if (profileRef) {
        profileRef.ensureWorkers = ensureWorkers;
        profileRef.currentProfile = currentProfile;
      }
      await finished;
      const result = [];
      merged.forEach((points) => result.push(...points));
      if (!result.length) throw new AIError('AI 未能识别出知识点，请重试');
      return result;
    }

    async function generateCards(zoneId, points, onProgress, profileRef) {
      const config = await core.getActiveAIConfig();
      if (!points || !points.length) throw new AIError('请先执行分析并确认知识点');
      const zoneFiles = await core.getZoneSourceFiles(zoneId);
      const flat = [];
      points.forEach((item) => {
        if (item && Array.isArray(item.points)) flat.push(...item.points);
        else flat.push(item);
      });
      const normalized = flat
        .map((point) => {
          if (point && typeof point === 'object') {
            return {
              title: String(point.title || '').trim(),
              description: String(point.description || ''),
              block_name: String(point.block_name || '').trim(),
              difficulty: normalizeDifficulty(point.difficulty),
              file_id: point.file_id ? Number(point.file_id) : undefined,
              exam_type: point.exam_type || '',
              exam_question: point.exam_question || '',
              exam_options: Array.isArray(point.exam_options) ? point.exam_options.slice() : [],
              exam_answer: point.exam_answer || ''
            };
          }
          return {
            title: String(point || '').trim(),
            description: '',
            block_name: '',
            difficulty: '中',
            file_id: undefined,
            exam_type: '',
            exam_question: '',
            exam_options: [],
            exam_answer: ''
          };
        })
        .filter((p) => p.title);
      const selectedFileIds = new Set(normalized.map((point) => point.file_id).filter(Boolean));
      const totalBytes = zoneFiles
        .filter((file) => (selectedFileIds.size ? selectedFileIds.has(file.id) : true))
        .reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      const profile = resolveSpeedProfile(await core.getSettings(), totalBytes);
      const currentProfile = () => (profileRef && profileRef.value) || profile;
      let generated = 0;
      const failed = [];
      let done = 0;
      const indexed = normalized.map((point, index) => ({ point, sortOrder: index + 1 }));
      let nextIndex = 0;
      const takeBatch = () => {
        if (nextIndex >= indexed.length) return null;
        const size = Math.max(1, currentProfile().cardBatchSize || 1);
        const batch = indexed.slice(nextIndex, nextIndex + size);
        nextIndex += batch.length;
        return batch;
      };
      const generateOne = async (item) => {
        if (item.point.exam_options && item.point.exam_options.length >= 2) {
          return core.generateCard(zoneId, item.point, examCardFromPoint(item.point, item.sortOrder), item.sortOrder);
        }
        const messages = [
          { role: 'system', content: CARD_SYSTEM },
          {
            role: 'user',
            content: `知识点：${item.point.title}\n补充说明：${item.point.description}\n请生成一道选择题。`
          }
        ];
        const data = await chatJson(config.api_key, config.base_url, config.model, messages, 150000);
        const card = parseCard(data);
        return core.generateCard(zoneId, item.point, card, item.sortOrder);
      };
      const generateBatch = async (batch) => {
        if (batch.length === 1) return generateOne(batch[0]);
        if (batch.every((item) => item.point.exam_options && item.point.exam_options.length >= 2)) {
          let added = 0;
          for (const item of batch) {
            if (await core.generateCard(zoneId, item.point, examCardFromPoint(item.point, item.sortOrder), item.sortOrder)) added++;
          }
          return added;
        }
        const itemsText = batch
          .map((item, idx) => `${idx + 1}. 知识点：${item.point.title}\n补充说明：${item.point.description}`)
          .join('\n\n');
        const messages = [
          { role: 'system', content: CARD_BATCH_SYSTEM },
          {
            role: 'user',
            content: `请按顺序为下面 ${batch.length} 个知识点生成选择题：\n\n${itemsText}`
          }
        ];
        const data = await chatJson(config.api_key, config.base_url, config.model, messages, 240000);
        const rawCards = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : []);
        if (rawCards.length !== batch.length) {
          throw new AIError(`批量返回的卡片数量不完整（期望 ${batch.length}，实际 ${rawCards.length}）`);
        }
        const parsed = rawCards.map((cardData, idx) => ({
          item: batch[idx],
          card: parseCard(cardData)
        }));
        let added = 0;
        for (const entry of parsed) {
          if (await core.generateCard(zoneId, entry.item.point, entry.card, entry.item.sortOrder)) added++;
        }
        return added;
      };
      let activeWorkers = 0;
      let resolveFinished;
      const finished = new Promise((resolve) => { resolveFinished = resolve; });
      const desired = () => Math.max(1, currentProfile().generateConcurrency || 1);
      const maybeFinished = () => {
        if (activeWorkers === 0 && nextIndex >= indexed.length) resolveFinished();
      };
      const worker = async () => {
        activeWorkers++;
        try {
          while (true) {
            if (activeWorkers > desired()) break;
            const batch = takeBatch();
            if (!batch) break;
          try {
            generated += await generateBatch(batch);
          } catch (err) {
            for (const item of batch) {
              try {
                if (await generateOne(item)) generated++;
              } catch (err2) {
                failed.push({ title: item.point.title, error: err2.message || String(err2) });
              }
            }
          }
          done += batch.length;
          if (onProgress) onProgress(done, normalized.length);
          }
        } finally {
          activeWorkers--;
          maybeFinished();
        }
      };
      const ensureWorkers = () => {
        while (activeWorkers < desired() && nextIndex < indexed.length) {
          worker();
        }
        maybeFinished();
      };
      ensureWorkers();
      if (profileRef) {
        profileRef.ensureWorkers = ensureWorkers;
        profileRef.currentProfile = currentProfile;
      }
      await finished;
      return { generated, failed, total: normalized.length };
    }

    async function listModels(apiKey, baseUrl, timeoutMs) {
      const url = String(baseUrl || '').replace(/\/+$/, '') + '/models';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const items = payload && Array.isArray(payload.data) ? payload.data : payload && Array.isArray(payload.models) ? payload.models : [];
        const ids = items
          .map((item) => (typeof item === 'string' ? item.trim() : item && (item.id || item.model || item.name)))
          .filter(Boolean)
          .map(String);
        return Array.from(new Set(ids)).sort();
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    }

    async function testConnection(apiKey, baseUrl, model) {
      const url = String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: '请只回复：OK' }],
            max_tokens: 8,
            temperature: 0
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
        }
        const payload = await res.json();
        const reply = (payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content || '').trim();
        return {
          ok: true,
          latency: ((Date.now() - start) / 1000).toFixed(2),
          reply: reply || '正常',
          model,
          channel: '直连'
        };
      } catch (err) {
        clearTimeout(timer);
        throw new AIError(`直连连接失败：${err.message || err}`);
      }
    }

    return { analyzeZone, generateCards, listModels, testConnection, resolveSpeedProfile, AIError };
  }

  return { create, AIError };
});
