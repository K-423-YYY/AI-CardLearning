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
    '只输出一个 JSON 对象，格式：{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分", "hint": "一条学习提示（可选）"}。' +
    'answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。';

  const CARD_BATCH_SYSTEM =
    '你是出题助手。根据给定的多个知识点，为每个知识点生成一道四选一选择题。' +
    '只输出一个 JSON 对象，格式：{"cards": [{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分", "hint": "一条学习提示（可选）"}]}。' +
    'cards 的数量必须与提供的知识点数量一致，顺序保持一致。answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。';

  const REFINE_STAGE1_SYSTEM =
    '你是知识精炼助手，负责学习资料的结构范围分析。请阅读用户上传的内容，输出：' +
    '1. scope：一句话概括资料的知识领域、覆盖主题和深度；' +
    '2. outline：章节大纲，用字符串数组表达原有章节逻辑和概念层级，允许用 "1.2 标题" 这类带层级的编号；' +
    '3. issues：疑似错误清单，数组元素为 {"source": "原文依据", "issue": "疑似错误/矛盾/过时信息", "reason": "理由", "suggestion": "修改建议"}；没有发现问题时返回空数组；' +
    '4. blocks 和 exam_questions：继续按标准知识点格式提取全部知识点。' +
    '只输出一个 JSON 对象，格式：{"scope": "...", "outline": ["1. ...", "1.1 ..."], "issues": [{"source": "...", "issue": "...", "reason": "...", "suggestion": "..."}], "blocks": [{"name": "区块名", "points": [{"title": "知识点标题", "description": "一句话说明", "difficulty": "易或中或难"}]}], "exam_questions": []}。' +
    '不要输出 JSON 以外的任何文字。';

  const REFINE_STAGE2_SYSTEM =
    '你是知识延伸助手。根据用户已经确认的知识点，补充对学习和工作有实质帮助的延伸内容。' +
    '只输出一个 JSON 对象，格式：{"extensions": [{"category": "关联高阶概念", "title": "条目标题", "content": "详细内容", "reason": "补充理由，说明对学习或工作的帮助"}]}。' +
    'category 只能是 "关联高阶概念"、"实际应用/案例"、"前沿动态或易混淆辨析" 三者之一。' +
    '条数不能超过用户要求的数量，没有合适内容时可以返回空数组。不要输出 JSON 以外的任何文字。';

  const REFINE_STAGE3_SYSTEM =
    '你是知识结构化拆解助手。请把用户提供的全部知识点拆成原子化条目（每条只表达一个可独立记忆、可验证的要点），' +
    '再逐层聚合成 大结构 -> 结构 -> 区块 的三级知识树。' +
    '只输出一个 JSON 对象，格式：{"tree": [{"name": "大结构名", "structures": [{"name": "结构名", "blocks": [{"name": "区块名", "points": [{"title": "原子知识点标题", "description": "一句话说明", "difficulty": "易或中或难"}]}]}]}]}。' +
    '所有输入知识点都必须出现在树中，不得遗漏也不得凭空新增。不要输出 JSON 以外的任何文字。';

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
      label: ['必考', '常考', '加分'].includes(label) ? label : '常考',
      hint: String((data && data.hint) || '').trim()
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

    function parseRefine(data, fileId) {
      const points = parseBlocks(data, fileId);
      return {
        scope: String((data && data.scope) || '').trim(),
        outline: Array.isArray(data && data.outline)
          ? data.outline.map((item) => String(item).trim()).filter(Boolean)
          : [],
        issues: Array.isArray(data && data.issues)
          ? data.issues.map((item) => ({
              source: String((item && item.source) || '').trim(),
              issue: String((item && item.issue) || '').trim(),
              reason: String((item && item.reason) || '').trim(),
              suggestion: String((item && item.suggestion) || '').trim()
            })).filter((item) => item.issue)
          : [],
        points
      };
    }

    async function refineAnalyze(zoneId, onProgress, fileIds, profileRef) {
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
                text: `请分析这张图片《${job.filename}》，完成结构范围分析并提取全部核心知识点。`
              },
              { type: 'image_url', image_url: { url: job.image } }
            ]
          : job.chunk;
        const data = await chatJson(config.api_key, config.base_url, config.model, [
          { role: 'system', content: REFINE_STAGE1_SYSTEM },
          { role: 'user', content: userContent }
        ], 240000);
        return parseRefine(data, job.fileId);
      };
      if (jobs.length === 1) {
        const result = await analyze(jobs[0]);
        if (onProgress) onProgress(1, 1);
        return {
          scope: result.scope,
          outline: result.outline,
          issues: result.issues,
          knowledge_points: result.points
        };
      }
      const queue = jobs.slice();
      const merged = { scope: '', outline: [], issues: [], points: [] };
      const seen = new Set();
      let done = 0;
      let activeWorkers = 0;
      let resolveFinished;
      const finished = new Promise((resolve) => { resolveFinished = resolve; });
      const desired = () => Math.max(1, currentProfile().analyzeConcurrency || 1);
      const maybeFinished = () => {
        if (activeWorkers === 0 && queue.length === 0) resolveFinished();
      };
      const addResult = (result) => {
        if (!merged.scope && result.scope) merged.scope = result.scope;
        result.outline.forEach((item) => {
          if (!merged.outline.includes(item)) merged.outline.push(item);
        });
        result.issues.forEach((item) => merged.issues.push(item));
        result.points.forEach((p) => {
          const key = `${p.block_name}::${p.title}`;
          if (seen.has(key)) return;
          seen.add(key);
          merged.points.push(p);
        });
      };
      const worker = async () => {
        activeWorkers++;
        try {
          while (queue.length) {
            if (activeWorkers > desired()) break;
            const job = queue.shift();
            addResult(await analyze(job));
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
      if (!merged.points.length) throw new AIError('AI 未能识别出知识点，请重试');
      return {
        scope: merged.scope,
        outline: merged.outline,
        issues: merged.issues,
        knowledge_points: merged.points
      };
    }

    async function refineExtend(zoneId, points, options) {
      const config = await core.getActiveAIConfig();
      const items = (points || []).filter((p) => p && p.title);
      if (!items.length) throw new AIError('请先完成结构范围分析');
      const limit = Math.max(1, Math.min(20, Number((options && options.max_items) || 8) || 8));
      const text = items.map((p, i) => `${i + 1}. 知识点：${p.title}\n说明：${p.description || ''}`).join('\n');
      const data = await chatJson(config.api_key, config.base_url, config.model, [
        { role: 'system', content: REFINE_STAGE2_SYSTEM },
        { role: 'user', content: `最多补充 ${limit} 条延伸内容。\n\n${text}` }
      ], 240000);
      const raw = Array.isArray(data && data.extensions) ? data.extensions : [];
      const categories = ['关联高阶概念', '实际应用/案例', '前沿动态或易混淆辨析'];
      return {
        extensions: raw.slice(0, limit).map((item, idx) => ({
          id: `ext-${idx + 1}`,
          category: categories.includes(String(item && item.category || '').trim())
            ? String(item.category).trim()
            : '关联高阶概念',
          title: String((item && item.title) || '').trim(),
          content: String((item && item.content) || '').trim(),
          reason: String((item && item.reason) || '').trim()
        })).filter((item) => item.title)
      };
    }

    function flattenRefineTree(tree, path, out) {
      (Array.isArray(tree) ? tree : []).forEach((node) => {
        const name = String((node && node.name) || '').trim() || '未命名';
        const next = path.concat(name);
        const structures = (node && node.structures) || [];
        const blocks = (node && node.blocks) || [];
        if (structures.length) {
          flattenRefineTree(structures, next, out);
        } else if (blocks.length) {
          blocks.forEach((block) => {
            const blockName = String((block && block.name) || '').trim() || '未分区';
            const blockPath = next.concat(blockName);
            (block.points || []).forEach((point) => {
              if (point && point.title) {
                out.push({
                  title: String(point.title).trim(),
                  description: String(point.description || ''),
                  difficulty: normalizeDifficulty(point.difficulty),
                  block_name: blockName,
                  path: blockPath.join(' / ')
                });
              }
            });
          });
        }
      });
      return out;
    }

    async function refineDecompose(zoneId, points, options) {
      const config = await core.getActiveAIConfig();
      const items = (points || []).filter((p) => p && p.title);
      if (!items.length) throw new AIError('请先确认知识点与延伸内容');
      const text = items.map((p, i) => `${i + 1}. 区块：${p.block_name || '未分区'}\n知识点：${p.title}\n说明：${p.description || ''}`).join('\n');
      const data = await chatJson(config.api_key, config.base_url, config.model, [
        { role: 'system', content: REFINE_STAGE3_SYSTEM },
        { role: 'user', content: text }
      ], 300000);
      const tree = Array.isArray(data && data.tree) ? data.tree : [];
      const pointsOut = flattenRefineTree(tree, [], []);
      if (!pointsOut.length) throw new AIError('AI 未能完成结构化拆解，请重试');
      return { tree, points: pointsOut };
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
              back_detail: String(point.back_detail || '').trim(),
              learning_hint: String(point.learning_hint || '').trim(),
              source_ref: String(point.source_ref || '').trim(),
              path: String(point.path || '').trim(),
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
            back_detail: '',
            learning_hint: '',
            source_ref: '',
            path: '',
            block_name: '',
            difficulty: '中',
            file_id: undefined,
            exam_type: '',
            exam_question: '',
            exam_options: [],
            exam_answer: ''
          };
        })
      const selectedFileIds = new Set(normalized.map((point) => point.file_id).filter(Boolean));
      const totalBytes = zoneFiles
        .filter((file) => (selectedFileIds.size ? selectedFileIds.has(file.id) : true))
        .reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      const profile = resolveSpeedProfile(await core.getSettings(), totalBytes);
      const currentProfile = () => (profileRef && profileRef.value) || profile;
      let generated = 0;
      let skipped = 0;
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
          const result = await core.generateCard(zoneId, item.point, examCardFromPoint(item.point, item.sortOrder), item.sortOrder);
          if (result && result.skipped) { skipped++; return 0; }
          return result ? 1 : 0;
        }
        const messages = [
          { role: 'system', content: CARD_SYSTEM },
          { role: 'user', content: `知识点：${item.point.title}\n补充说明：${item.point.description}\n请生成一道选择题。` }
        ];
        const data = await chatJson(config.api_key, config.base_url, config.model, messages, 150000);
        const card = parseCard(data);
        const result = await core.generateCard(zoneId, item.point, card, item.sortOrder);
        if (result && result.skipped) { skipped++; return 0; }
        return result ? 1 : 0;
      };
      const generateBatch = async (batch) => {
        if (batch.length === 1) return generateOne(batch[0]);
        if (batch.every((item) => item.point.exam_options && item.point.exam_options.length >= 2)) {
          let added = 0;
          for (const item of batch) {
            const result = await core.generateCard(zoneId, item.point, examCardFromPoint(item.point, item.sortOrder), item.sortOrder);
            if (result && result.skipped) skipped++;
            else if (result) added++;
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
          const result = await core.generateCard(zoneId, entry.item.point, entry.card, entry.item.sortOrder);
          if (result && result.skipped) skipped++;
          else if (result) added++;
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
            const batchResult = await generateBatch(batch);
            generated += (typeof batchResult === 'number' ? batchResult : 0);
          } catch (err) {
            for (const item of batch) {
              try {
                const oneResult = await generateOne(item);
                generated += (typeof oneResult === 'number' ? oneResult : 0);
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
      return { generated, skipped, failed, total: normalized.length };
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

    return {
      analyzeZone,
      refineAnalyze,
      refineExtend,
      refineDecompose,
      generateCards,
      listModels,
      testConnection,
      resolveSpeedProfile,
      AIError
    };
  }

  return { create, AIError };
});
