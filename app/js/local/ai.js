(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalAI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ANALYZE_SYSTEM =
    '你是学习资料分析助手。请阅读用户上传的学习资料，完整提取全部核心知识点，' +
    '不得遗漏文件中的任何知识点，也不能凭空增加文件里没有的内容。' +
    '把知识点按内容主题分成若干个区块，每个知识点只能属于一个区块。' +
    '只输出一个 JSON 对象，格式：{"blocks": [{"name": "区块名", "points": [{"title": "知识点标题", "description": "一句话说明", "difficulty": "易或中或难"}]}]}。' +
    '不要输出 JSON 以外的任何文字。';

  const CARD_SYSTEM =
    '你是出题助手。根据给定的知识点生成一道四选一选择题。' +
    '只输出一个 JSON 对象，格式：{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分"}。' +
    'answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。';

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

    function parseBlocks(data) {
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
              difficulty: normalizeDifficulty(point.difficulty)
            });
          }
        });
      });
      return result;
    }

    async function analyzeZone(zoneId, onProgress) {
      const config = await core.getActiveAIConfig();
      const files = await core.getZoneSourceFiles(zoneId);
      if (!files.length) throw new AIError('学习区还没有文件，请先上传文件');
      const parts = files.map((f) => `文件《${f.filename}》：\n${String(f.content || '').slice(0, 60000)}`);
      const payload = parts.join('\n\n').slice(0, 200000);
      const analyze = async (content) => {
        const data = await chatJson(config.api_key, config.base_url, config.model, [
          { role: 'system', content: ANALYZE_SYSTEM },
          { role: 'user', content }
        ]);
        return parseBlocks(data);
      };

      if (payload.length <= 80000) {
        const result = await analyze(payload);
        if (!result.length) throw new AIError('AI 未能识别出知识点，请重试');
        if (onProgress) onProgress(1, 1);
        return result;
      }

      const chunks = splitText(payload, 60000);
      const queue = chunks.slice();
      const merged = new Map();
      const seen = new Set();
      let done = 0;
      const worker = async () => {
        while (queue.length) {
          const chunk = queue.shift();
          const points = await analyze(chunk);
          points.forEach((p) => {
            const key = `${p.block_name}::${p.title}`;
            if (seen.has(key)) return;
            seen.add(key);
            if (!merged.has(p.block_name)) merged.set(p.block_name, []);
            merged.get(p.block_name).push(p);
          });
          done++;
          if (onProgress) onProgress(done, chunks.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, worker));
      const result = [];
      merged.forEach((points) => result.push(...points));
      if (!result.length) throw new AIError('AI 未能识别出知识点，请重试');
      return result;
    }

    async function generateCards(zoneId, points, onProgress) {
      const config = await core.getActiveAIConfig();
      if (!points || !points.length) throw new AIError('请先执行分析并确认知识点');
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
              difficulty: normalizeDifficulty(point.difficulty)
            };
          }
          return { title: String(point || '').trim(), description: '', block_name: '', difficulty: '中' };
        })
        .filter((p) => p.title);
      let generated = 0;
      const failed = [];
      let done = 0;
      const queue = normalized.map((point, i) => ({ point, i }));
      const worker = async () => {
        while (queue.length) {
          const item = queue.shift();
          const point = item.point;
          try {
            const messages = [
              { role: 'system', content: CARD_SYSTEM },
              {
                role: 'user',
                content: `知识点：${point.title}\n补充说明：${point.description}\n请生成一道选择题。`
              }
            ];
            const data = await chatJson(config.api_key, config.base_url, config.model, messages, 150000);
            const card = parseCard(data);
            const added = await core.generateCard(zoneId, point, card, item.i + 1);
            if (added) generated++;
          } catch (err) {
            failed.push({ title: point.title, error: err.message || String(err) });
          }
          done++;
          if (onProgress) onProgress(done, normalized.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, normalized.length) }, worker));
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

    return { analyzeZone, generateCards, listModels, testConnection, AIError };
  }

  return { create, AIError };
});
