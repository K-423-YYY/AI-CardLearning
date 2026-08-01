(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS_TODO = '待学';
  const STATUS_DONE = '成功';
  const STATUS_REVIEW = '重点复习';
  const STATUS_LEVEL_DONE = '已通关';
  const STATUS_LEVEL_TODO = '待闯关';
  const LEVEL_TYPE_NEW = '新学';
  const LEVEL_TYPE_REVIEW = '复习';
  const ROLE_NEW = '新学';
  const ROLE_REVIEW = '复习';
  const SORT_EASY = 'easy_to_hard';
  const SORT_BLOCK = 'block';
  const MODE_DAILY = 'daily';
  const MODE_REPLAY = 'replay';
  const MODE_WRONG = 'wrong';
  const REVIEW_INTERVALS = [1, 2, 4, 7, 15];
  const REVIEW_CLUSTER_TARGET = 15;
  const REVIEW_CLUSTER_MAX_GAP = 3;
  const DEFAULT_DAILY_LIMIT = 5;
  const DIFFICULTY_ORDER = { 易: 0, 中: 1, 难: 2 };

  const AI_PROVIDERS = {
    deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    kimi: { name: 'Kimi（月之暗面）', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    qwen: { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu: { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    siliconflow: { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    custom: { name: '自定义', base_url: '', model: '' }
  };

  class LocalError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = 'LocalError';
    }
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function nowStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateAdd(dateStr, days) {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function daysDiff(fromStr, toStr) {
    const a = new Date(fromStr.slice(0, 4), Number(fromStr.slice(5, 7)) - 1, Number(fromStr.slice(8, 10)));
    const b = new Date(toStr.slice(0, 4), Number(toStr.slice(5, 7)) - 1, Number(toStr.slice(8, 10)));
    return Math.round((b - a) / 86400000);
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (const ch of str) {
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

  function shuffledLetters(cardId, wrongCount, dateStr) {
    const rng = mulberry32(hashSeed(`${cardId}:${wrongCount}:${dateStr}`));
    const letters = ['A', 'B', 'C', 'D'];
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = letters[i];
      letters[i] = letters[j];
      letters[j] = tmp;
    }
    return letters;
  }

  function shuffledOptions(card, wrongCount, dateStr) {
    const letters = ['A', 'B', 'C', 'D'];
    const originals = shuffledLetters(card.id, wrongCount, dateStr);
    const options = [card.option_a, card.option_b, card.option_c, card.option_d];
    const mapping = {};
    originals.forEach((original, newIndex) => {
      mapping[letters[newIndex]] = options[letters.indexOf(original)];
    });
    const answer = letters[originals.indexOf(card.answer)];
    return [mapping, answer];
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function createCore(db) {
    async function cardsByZone(zoneId) {
      const files = await db.where('files', (f) => f.zone_id === zoneId);
      const fileIds = new Set(files.map((f) => f.id));
      const cards = await db.all('cards');
      return cards.filter((c) => fileIds.has(c.file_id));
    }

    async function zoneExists(zoneId) {
      const zone = await db.get('zones', zoneId);
      return !!zone;
    }

    async function zoneLevelLimit(zoneId) {
      const zs = await db.get('zone_settings', zoneId);
      if (zs && zs.daily_limit) return zs.daily_limit;
      const s = await db.get('settings', 'profile');
      return (s && s.daily_card_limit) || DEFAULT_DAILY_LIMIT;
    }

    async function zoneSortMode(zoneId) {
      const zs = await db.get('zone_settings', zoneId);
      if (zs && (zs.sort_mode === SORT_EASY || zs.sort_mode === SORT_BLOCK)) return zs.sort_mode;
      return SORT_EASY;
    }

    async function zoneCreatedDate(zoneId) {
      const zone = await db.get('zones', zoneId);
      if (!zone) return todayStr();
      return String(zone.created_at || todayStr()).slice(0, 10);
    }

    async function zoneTotalCards(zoneId) {
      return (await cardsByZone(zoneId)).length;
    }

    async function pendingNewCards(zoneId) {
      const sortMode = await zoneSortMode(zoneId);
      const cards = (await cardsByZone(zoneId)).filter((c) => c.status !== STATUS_DONE);
      cards.sort((a, b) => {
        if (sortMode === SORT_BLOCK && (a.block_name || '') !== (b.block_name || '')) {
          return (a.block_name || '').localeCompare(b.block_name || '', 'zh-Hans-CN');
        }
        const da = DIFFICULTY_ORDER[a.difficulty] === undefined ? 1 : DIFFICULTY_ORDER[a.difficulty];
        const db_ = DIFFICULTY_ORDER[b.difficulty] === undefined ? 1 : DIFFICULTY_ORDER[b.difficulty];
        if (da !== db_) return da - db_;
        if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
        return a.id - b.id;
      });
      return cards.map((c) => c.id);
    }

    async function reviewEvents(zoneId) {
      const newCount = Math.max(1, await zoneLevelLimit(zoneId));
      const pending = await pendingNewCards(zoneId);
      const events = [];
      pending.forEach((cardId, idx) => {
        const dayNo = Math.floor(idx / newCount) + 1;
        REVIEW_INTERVALS.forEach((interval) => {
          events.push([cardId, dayNo + interval]);
        });
      });
      const start = await zoneCreatedDate(zoneId);
      const schedules = await db.where('review_schedule', (r) => r.zone_id === zoneId && r.status === 'pending');
      schedules.forEach((row) => {
        const dayNo = Math.max(1, daysDiff(start, row.review_date) + 1);
        events.push([row.card_id, dayNo]);
      });
      return events;
    }

    function clusterReviewEvents(events) {
      const counts = {};
      events.forEach(([cardId, dayNo]) => {
        (counts[dayNo] = counts[dayNo] || new Set()).add(cardId);
      });
      const days = Object.keys(counts).map(Number).sort((a, b) => a - b);
      const clusters = [];
      let i = 0;
      while (i < days.length) {
        const startDay = days[i];
        const cards = new Set();
        let lastDay = startDay;
        while (i < days.length) {
          const d = days[i];
          if (cards.size && d - startDay > REVIEW_CLUSTER_MAX_GAP) break;
          counts[d].forEach((cid) => cards.add(cid));
          lastDay = d;
          i++;
          if (cards.size >= REVIEW_CLUSTER_TARGET) break;
        }
        const daysArr = [];
        for (let d = startDay; d <= lastDay; d++) daysArr.push(d);
        clusters.push({ day_no: startDay, card_ids: Array.from(cards).sort((a, b) => a - b), days: daysArr });
      }
      return clusters;
    }

    function dayReviewClusters(events) {
      const counts = {};
      events.forEach(([cardId, dayNo]) => {
        (counts[dayNo] = counts[dayNo] || new Set()).add(cardId);
      });
      return Object.keys(counts)
        .map(Number)
        .sort((a, b) => a - b)
        .map((dayNo) => ({
          day_no: dayNo,
          card_ids: Array.from(counts[dayNo]).sort((a, b) => a - b),
          days: [dayNo]
        }));
    }

    function mergeReviewClusters(clusters, target) {
      const list = clusters.map((c) => ({ ...c, card_ids: c.card_ids.slice() }));
      if (target <= 0) return [];
      while (list.length > target) {
        if (list.length <= 1) break;
        let bestIdx = 0;
        let bestSize = null;
        for (let i = 0; i < list.length - 1; i++) {
          const mergedSize = new Set([...list[i].card_ids, ...list[i + 1].card_ids]).size;
          if (bestSize === null || mergedSize < bestSize) {
            bestSize = mergedSize;
            bestIdx = i;
          }
        }
        const left = list[bestIdx];
        const right = list[bestIdx + 1];
        const merged = {
          day_no: Math.min(left.day_no, right.day_no),
          card_ids: unique([...left.card_ids, ...right.card_ids]).sort((a, b) => a - b),
          days: unique([...left.days, ...right.days]).sort((a, b) => a - b)
        };
        list.splice(bestIdx, 2, merged);
      }
      return list;
    }

    async function computeLevelBounds(zoneId) {
      const total = await zoneTotalCards(zoneId);
      const newCount = Math.max(1, await zoneLevelLimit(zoneId));
      if (total === 0) {
        return { lower: 0, upper: 0, recommended: 0, new_count: newCount };
      }
      const pending = await pendingNewCards(zoneId);
      const newLevelCount = pending.length ? Math.ceil(pending.length / newCount) : 0;
      const events = await reviewEvents(zoneId);
      const clusters = clusterReviewEvents(events);
      const dayClusters = dayReviewClusters(events);
      const strong = clusters.filter((c) => c.card_ids.length >= 4).length;
      let lower = Math.max(1, Math.ceil(total / newCount));
      const maxPossible = newLevelCount + dayClusters.length;
      if (maxPossible < lower) lower = Math.max(1, maxPossible);
      const upper = Math.max(lower, newLevelCount + clusters.length, newLevelCount + dayClusters.length);
      const reviewHint = clusters.length ? 1 : 0;
      const recommended = Math.min(upper, Math.max(lower, newLevelCount + Math.max(strong, reviewHint)));
      return { lower, upper, recommended, new_count: newCount };
    }

    async function buildLevelSpecs(zoneId, levelCount) {
      const newCount = Math.max(1, await zoneLevelLimit(zoneId));
      const pending = await pendingNewCards(zoneId);
      const newLevelCount = pending.length ? Math.ceil(pending.length / newCount) : 0;
      if (levelCount < newLevelCount) throw new LocalError(4007, '关卡数不能少于新学关下限');
      const sortMode = await zoneSortMode(zoneId);
      const specs = [];
      for (let lv = 1; lv <= newLevelCount; lv++) {
        const newIds = pending.slice((lv - 1) * newCount, lv * newCount);
        let name = '';
        if (sortMode === SORT_BLOCK && newIds.length) {
          const cards = await db.where('cards', (c) => newIds.includes(c.id) && c.block_name);
          const first = cards.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)[0];
          name = first ? first.block_name : '';
        }
        specs.push({
          level_no: lv,
          level_type: LEVEL_TYPE_NEW,
          name,
          day_no: lv,
          new_count: newIds.length,
          new_card_ids: newIds,
          card_ids: newIds
        });
      }
      let reviewCount = Math.max(0, levelCount - newLevelCount);
      const events = await reviewEvents(zoneId);
      let clusters = clusterReviewEvents(events);
      if (reviewCount < clusters.length) {
        clusters = mergeReviewClusters(clusters, reviewCount);
      } else if (reviewCount > clusters.length) {
        let dayClusters = dayReviewClusters(events);
        if (dayClusters.length < reviewCount) reviewCount = dayClusters.length;
        clusters = mergeReviewClusters(dayClusters, reviewCount);
      }
      clusters.forEach((cluster, offset) => {
        specs.push({
          level_no: newLevelCount + 1 + offset,
          level_type: LEVEL_TYPE_REVIEW,
          name: '',
          day_no: cluster.day_no,
          new_count: 0,
          new_card_ids: [],
          card_ids: cluster.card_ids
        });
      });
      return specs;
    }

    async function buildNewLevelSpecs(zoneId, pending, startLevelNo) {
      const newCount = Math.max(1, await zoneLevelLimit(zoneId));
      const sortMode = await zoneSortMode(zoneId);
      const specs = [];
      for (let offset = 0; offset < pending.length; offset += newCount) {
        const ids = pending.slice(offset, offset + newCount);
        let name = '';
        if (sortMode === SORT_BLOCK && ids.length) {
          const cards = await db.where('cards', (c) => ids.includes(c.id) && c.block_name);
          const first = cards.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)[0];
          name = first ? first.block_name : '';
        }
        const levelNo = startLevelNo + specs.length;
        specs.push({
          level_no: levelNo,
          level_type: LEVEL_TYPE_NEW,
          name,
          day_no: levelNo,
          new_count: ids.length,
          new_card_ids: ids,
          card_ids: ids
        });
      }
      return specs;
    }

    async function deleteCards(zoneId, cardIds) {
      const ids = unique(cardIds);
      if (!ids.length) return 0;
      const cards = await db.where('cards', (c) => ids.includes(c.id));
      const zoneCards = [];
      const files = await db.all('files');
      const zoneFileIds = new Set(files.filter((f) => f.zone_id === zoneId).map((f) => f.id));
      cards.forEach((c) => {
        if (zoneFileIds.has(c.file_id)) zoneCards.push(c);
      });
      const removeIds = zoneCards.map((c) => c.id);
      if (!removeIds.length) return 0;
      for (const storeName of ['level_cards', 'daily_tasks', 'review_schedule', 'records']) {
        const rows = await db.where(storeName, (r) => removeIds.includes(r.card_id));
        for (const row of rows) await db.delete(storeName, row.id);
      }
      for (const id of removeIds) await db.delete('cards', id);
      return removeIds.length;
    }

    async function rebuildZoneLevels(zoneId, levelCount = null, preserveCompleted = false) {
      const pending = await pendingNewCards(zoneId);
      const now = nowStr();
      let specs;
      if (preserveCompleted) {
        const doneLevels = (await db.where('levels', (l) => l.zone_id === zoneId && l.status === STATUS_LEVEL_DONE)).sort(
          (a, b) => a.level_no - b.level_no
        );
        const preserved = [];
        for (const lv of doneLevels) {
          const lc = await db.where('level_cards', (r) => r.zone_id === zoneId && r.level_no === lv.level_no);
          if (!lc.length) continue;
          const newIds = lc.filter((r) => r.role === ROLE_NEW).map((r) => r.card_id);
          const reviewIds = lc.filter((r) => r.role === ROLE_REVIEW).map((r) => r.card_id);
          preserved.push({
            level_type: lv.level_type,
            name: lv.name || '',
            day_no: lv.day_no,
            new_count: lv.new_count,
            new_card_ids: newIds,
            card_ids: unique([...newIds, ...reviewIds]),
            status: STATUS_LEVEL_DONE,
            completed_at: lv.completed_at
          });
        }
        const preservedIds = new Set(preserved.flatMap((s) => s.card_ids));
        const remaining = pending.filter((id) => !preservedIds.has(id));
        const newSpecs = await buildNewLevelSpecs(zoneId, remaining, preserved.length + 1);
        const clusters = clusterReviewEvents(await reviewEvents(zoneId));
        const reviewSpecs = clusters.map((c, idx) => ({
          level_no: preserved.length + newSpecs.length + 1 + idx,
          level_type: LEVEL_TYPE_REVIEW,
          name: '',
          day_no: c.day_no,
          new_count: 0,
          new_card_ids: [],
          card_ids: c.card_ids
        }));
        specs = [...preserved, ...newSpecs, ...reviewSpecs];
      } else {
        const bounds = await computeLevelBounds(zoneId);
        let target = levelCount;
        if (target === null || target === undefined) {
          const zs = await db.get('zone_settings', zoneId);
          target = zs && zs.level_count ? zs.level_count : bounds.recommended;
        }
        if (bounds.upper > 0) {
          target = Math.max(bounds.lower, Math.min(bounds.upper, target || bounds.lower));
        }
        if (!target || target <= 0) return 0;
        specs = await buildLevelSpecs(zoneId, target);
      }
      specs.forEach((spec, idx) => {
        spec.level_no = idx + 1;
      });
      for (const row of await db.where('level_cards', (r) => r.zone_id === zoneId)) {
        await db.delete('level_cards', row.id);
      }
      for (const row of await db.where('levels', (r) => r.zone_id === zoneId)) {
        await db.delete('levels', row.id);
      }
      for (const spec of specs) {
        await db.insert('levels', {
          zone_id: zoneId,
          level_no: spec.level_no,
          name: spec.name || '',
          level_type: spec.level_type,
          day_no: spec.day_no,
          new_count: spec.new_count,
          daily_limit: await zoneLevelLimit(zoneId),
          status: spec.status || STATUS_LEVEL_TODO,
          completed_at: spec.completed_at || null,
          created_at: now
        });
        for (const cardId of spec.card_ids) {
          await db.insert('level_cards', {
            id: `lc:${zoneId}:${spec.level_no}:${cardId}`,
            zone_id: zoneId,
            level_no: spec.level_no,
            card_id: cardId,
            role: spec.new_card_ids.includes(cardId) ? ROLE_NEW : ROLE_REVIEW,
            created_at: now
          });
        }
        if (spec.new_card_ids.length) {
          const cards = await db.where('cards', (c) => spec.new_card_ids.includes(c.id));
          for (const card of cards) {
            card.level_no = spec.level_no;
            await db.put('cards', card);
          }
        }
      }
      const limit = await zoneLevelLimit(zoneId);
      await db.put('zone_settings', {
        id: zoneId,
        zone_id: zoneId,
        daily_limit: limit,
        level_count: specs.length,
        sort_mode: await zoneSortMode(zoneId),
        updated_at: now
      });
      return specs.length;
    }

    async function wrongCardIds(zoneId) {
      const records = await db.all('records');
      const wrong = new Set();
      const cards = await cardsByZone(zoneId);
      const cardIds = new Set(cards.map((c) => c.id));
      records
        .filter((r) => r.is_correct === 0 && cardIds.has(r.card_id))
        .sort((a, b) => a.id - b.id)
        .forEach((r) => wrong.add(r.card_id));
      return Array.from(wrong);
    }

    async function recordCheckin(zoneId, dateStr, now) {
      await db.put('checkins', {
        id: `c:${zoneId}:${dateStr}`,
        user_id: 1,
        zone_id: zoneId,
        checkin_date: dateStr,
        created_at: now
      });
    }

    async function levelRows(zoneId) {
      return (await db.where('levels', (l) => l.zone_id === zoneId)).sort((a, b) => a.level_no - b.level_no);
    }

    async function levelRoleCards(zoneId, levelNo, role) {
      const rows = await db.where('level_cards', (r) => r.zone_id === zoneId && r.level_no === levelNo && (!role || r.role === role));
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return rows.map((r) => r.card_id);
    }

    async function pendingNewIds(zoneId, levelNo) {
      let cardIds = await levelRoleCards(zoneId, levelNo, ROLE_NEW);
      if (!cardIds.length) {
        const cards = await db.where('cards', (c) => c.level_no === levelNo && c.status !== STATUS_DONE);
        return cards.map((c) => c.id).sort((a, b) => a - b);
      }
      const cards = await db.where('cards', (c) => cardIds.includes(c.id) && c.status !== STATUS_DONE);
      return cards.map((c) => c.id);
    }

    async function dueReviewIds(zoneId, dateStr) {
      const rows = await db.where(
        'review_schedule',
        (r) => r.zone_id === zoneId && r.status === 'pending' && r.review_date <= dateStr
      );
      return unique(rows.map((r) => r.card_id));
    }

    async function firstActionableLevel(zoneId, dateStr) {
      const due = await dueReviewIds(zoneId, dateStr);
      const levels = await levelRows(zoneId);
      for (const lv of levels) {
        if (lv.status === STATUS_LEVEL_DONE) continue;
        if (lv.level_type === LEVEL_TYPE_NEW && (await pendingNewIds(zoneId, lv.level_no)).length) return lv;
        if (due.length) return lv;
      }
      return null;
    }

    async function scheduleReviews(zoneId, cardId, dateStr, now) {
      const rows = await db.where(
        'review_schedule',
        (r) => r.zone_id === zoneId && r.card_id === cardId && r.status === 'pending'
      );
      for (const row of rows) await db.delete('review_schedule', row.id);
      for (const interval of REVIEW_INTERVALS) {
        await db.put('review_schedule', {
          id: `r:1:${cardId}:${dateAdd(dateStr, interval)}`,
          user_id: 1,
          zone_id: zoneId,
          card_id: cardId,
          review_date: dateAdd(dateStr, interval),
          status: 'pending',
          created_at: now
        });
      }
    }

    async function scheduleWrongRetry(zoneId, cardId, dateStr, now) {
      const rows = await db.where(
        'review_schedule',
        (r) => r.zone_id === zoneId && r.card_id === cardId && r.status === 'pending'
      );
      for (const row of rows) await db.delete('review_schedule', row.id);
      await db.put('review_schedule', {
        id: `r:1:${cardId}:${dateAdd(dateStr, 1)}`,
        user_id: 1,
        zone_id: zoneId,
        card_id: cardId,
        review_date: dateAdd(dateStr, 1),
        status: 'pending',
        created_at: now
      });
    }

    async function levelReady(zoneId, level, dateStr) {
      if (level.level_type === LEVEL_TYPE_NEW) {
        if ((await pendingNewIds(zoneId, level.level_no)).length) return false;
      } else {
        const cardIds = await levelRoleCards(zoneId, level.level_no, ROLE_REVIEW);
        if (!cardIds.length) return true;
        const rows = await db.where('review_schedule', (r) => r.zone_id === zoneId && cardIds.includes(r.card_id));
        if (!rows.length) return false;
        if (rows.some((r) => r.status === 'pending')) return false;
      }
      return (await dueReviewIds(zoneId, dateStr)).length === 0;
    }

    async function syncLevelStatuses(zoneId, dateStr, now) {
      const levels = await levelRows(zoneId);
      for (const lv of levels) {
        if (lv.status === STATUS_LEVEL_DONE) continue;
        if (await levelReady(zoneId, lv, dateStr)) {
          lv.status = STATUS_LEVEL_DONE;
          lv.completed_at = now;
          await db.put('levels', lv);
          await recordCheckin(zoneId, dateStr, now);
        }
      }
    }

    async function hasActionableLevel(zoneId, dateStr) {
      return (await firstActionableLevel(zoneId, dateStr)) !== null;
    }

    async function ensureReviewLevelForDue(zoneId, dateStr, now) {
      const due = await dueReviewIds(zoneId, dateStr);
      if (!due.length) return null;
      let level = (
        await db.where('levels', (l) => l.zone_id === zoneId && l.status === STATUS_LEVEL_TODO && l.level_type === LEVEL_TYPE_REVIEW)
      ).sort((a, b) => a.level_no - b.level_no)[0];
      if (!level) {
        const levels = await levelRows(zoneId);
        const levelNo = levels.length ? levels[levels.length - 1].level_no + 1 : 1;
        const start = await zoneCreatedDate(zoneId);
        const dayNo = Math.max(1, daysDiff(start, dateStr) + 1);
        const limit = await zoneLevelLimit(zoneId);
        level = await db.insert('levels', {
          zone_id: zoneId,
          level_no: levelNo,
          name: '',
          level_type: LEVEL_TYPE_REVIEW,
          day_no: dayNo,
          new_count: 0,
          daily_limit: limit,
          status: STATUS_LEVEL_TODO,
          completed_at: null,
          created_at: now
        });
        await db.put('zone_settings', {
          id: zoneId,
          zone_id: zoneId,
          daily_limit: limit,
          level_count: levelNo,
          sort_mode: await zoneSortMode(zoneId),
          updated_at: now
        });
      }
      for (const cardId of due) {
        await db.put('level_cards', {
          id: `lc:${zoneId}:${level.level_no}:${cardId}`,
          zone_id: zoneId,
          level_no: level.level_no,
          card_id: cardId,
          role: ROLE_REVIEW,
          created_at: now
        });
      }
      return level;
    }

    async function ensureTodayTasks(zoneId, dateStr) {
      let existing = (await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr)).sort(
        (a, b) => a.position - b.position || a.id - b.id
      );
      const skipped = existing.filter((t) => t.status === 'skipped');
      if (skipped.length) {
        for (const t of skipped) {
          t.status = 'pending';
          await db.put('daily_tasks', t);
        }
        existing = (await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr)).sort(
          (a, b) => a.position - b.position || a.id - b.id
        );
      }
      if (existing.some((t) => t.status === 'pending')) return existing;

      const levelCount = (await levelRows(zoneId)).length;
      if (!levelCount) await rebuildZoneLevels(zoneId);
      const now = nowStr();
      await syncLevelStatuses(zoneId, dateStr, now);
      let current = await firstActionableLevel(zoneId, dateStr);
      if (!current) current = await ensureReviewLevelForDue(zoneId, dateStr, now);
      if (!current) return existing;

      let newIds = [];
      if (current.level_type === LEVEL_TYPE_NEW) {
        newIds = await pendingNewIds(zoneId, current.level_no);
      }
      const reviewIds = await dueReviewIds(zoneId, dateStr);
      const queueIds = unique([...shuffle(newIds), ...reviewIds]);
      if (!queueIds.length) return existing;
      const tasks = await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr);
      const maxPos = tasks.reduce((m, t) => Math.max(m, t.position || 0), 0);
      for (let i = 0; i < queueIds.length; i++) {
        await db.insert('daily_tasks', {
          user_id: 1,
          zone_id: zoneId,
          card_id: queueIds[i],
          task_date: dateStr,
          status: 'pending',
          position: maxPos + i + 1,
          level_no: current.level_no,
          mode: MODE_DAILY,
          created_at: now
        });
      }
      return (await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr)).sort(
        (a, b) => a.position - b.position || a.id - b.id
      );
    }

    async function getZone(zoneId) {
      const zone = await db.get('zones', zoneId);
      if (!zone) throw new LocalError(4040, '学习区不存在');
      return zone;
    }

    function toBase64(text) {
      if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(text)));
      return Buffer.from(text, 'utf8').toString('base64');
    }

    function fromBase64(text) {
      if (typeof atob === 'function') return decodeURIComponent(escape(atob(text)));
      return Buffer.from(text, 'base64').toString('utf8');
    }

    function toBinaryBase64(bytes) {
      let binary = '';
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      if (typeof btoa === 'function') return btoa(binary);
      return Buffer.from(bytes).toString('base64');
    }

    function fromBinaryBase64(text) {
      let binary;
      if (typeof atob === 'function') binary = atob(text);
      else binary = Buffer.from(text, 'base64').toString('binary');
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      return arr;
    }

    async function getSecretKey() {
      const existing = await db.get('keys', 'aes');
      if (existing && existing.value) return existing.value;
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const key = await globalThis.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
        await db.put('keys', { id: 'aes', value: key, created_at: nowStr() });
        return key;
      }
      return null;
    }

    async function encryptSecret(plain) {
      const text = String(plain || '');
      if (!text) return '';
      const key = await getSecretKey();
      if (key) {
        try {
          const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
          const cipher = await globalThis.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            new TextEncoder().encode(text)
          );
          const ivB64 = toBinaryBase64(iv);
          const dataB64 = toBinaryBase64(new Uint8Array(cipher));
          return `v1:${ivB64}:${dataB64}`;
        } catch (err) {
          // fall through to portable obfuscation when crypto storage is unavailable
        }
      }
      return `plain:${toBase64(text)}`;
    }

    async function decryptSecret(encrypted) {
      const value = String(encrypted || '');
      if (!value) return '';
      if (value.startsWith('plain:')) return fromBase64(value.slice(6));
      if (!value.startsWith('v1:')) return '';
      const [, ivB64, dataB64] = value.split(':');
      const key = await getSecretKey();
      if (!key) return '';
      try {
        const iv = fromBinaryBase64(ivB64);
        const data = fromBinaryBase64(dataB64);
        const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return new TextDecoder().decode(plain);
      } catch (err) {
        return '';
      }
    }

    async function getSettings() {
      const profile = (await db.get('settings', 'profile')) || {};
      const s = (await db.get('settings', 'user_settings')) || {};
      const active = await getActiveProviderRow();
      return {
        email: 'local@user',
        nickname: profile.nickname || '',
        daily_card_limit: s.daily_card_limit || DEFAULT_DAILY_LIMIT,
        ai_provider: s.ai_provider || 'deepseek',
        ai_base_url: s.ai_base_url || AI_PROVIDERS.deepseek.base_url,
        ai_model: s.ai_model || '',
        ai_api_key_configured: !!(active && active.api_key_encrypted),
        ai_api_key_masked: active && active.api_key_encrypted ? await maskKey(await decryptSecret(active.api_key_encrypted)) : '',
        backup_dir: s.backup_dir || '',
        backup_dir_uri: s.backup_dir_uri || '',
        backup_dir_label: s.backup_dir_label || '',
        speed_tier2_mb: s.speed_tier2_mb || 1,
        speed_tier3_mb: s.speed_tier3_mb || 5,
        speed_tier4_mb: s.speed_tier4_mb || 20,
        providers: Object.entries(AI_PROVIDERS).map(([id, preset]) => ({
          id,
          name: preset.name,
          base_url: preset.base_url,
          model: preset.model
        }))
      };
    }

    async function maskKey(key) {
      if (!key) return '';
      return `****${key.slice(-4)}`;
    }

    async function updateSettings(body) {
      const profile = (await db.get('settings', 'profile')) || {};
      const s = (await db.get('settings', 'user_settings')) || {};
      if (body.nickname !== undefined) profile.nickname = String(body.nickname).trim();
      if (body.daily_card_limit !== undefined) s.daily_card_limit = body.daily_card_limit;
      if (body.ai_provider !== undefined) s.ai_provider = body.ai_provider;
      if (body.ai_base_url !== undefined) s.ai_base_url = String(body.ai_base_url).trim();
      if (body.ai_model !== undefined && String(body.ai_model).trim()) s.ai_model = String(body.ai_model).trim();
      if (body.ai_api_key !== undefined && String(body.ai_api_key).trim()) {
        s.ai_api_key_encrypted = await encryptSecret(String(body.ai_api_key).trim());
      }
      if (body.backup_dir !== undefined) s.backup_dir = String(body.backup_dir).trim();
      if (body.backup_dir_uri !== undefined) s.backup_dir_uri = String(body.backup_dir_uri).trim();
      if (body.backup_dir_label !== undefined) s.backup_dir_label = String(body.backup_dir_label).trim();
      if (body.speed_tier2_mb !== undefined) s.speed_tier2_mb = Number(body.speed_tier2_mb) || 1;
      if (body.speed_tier3_mb !== undefined) s.speed_tier3_mb = Number(body.speed_tier3_mb) || 5;
      if (body.speed_tier4_mb !== undefined) s.speed_tier4_mb = Number(body.speed_tier4_mb) || 20;
      await db.put('settings', { id: 'profile', ...profile });
      await db.put('settings', { id: 'user_settings', ...s });
      await ensureDefaultProvider();
      return { saved: true };
    }

    async function providerRows() {
      return (await db.all('provider_configs')).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.id - b.id);
    }

    async function getActiveProviderRow() {
      const rows = await providerRows();
      return rows.find((r) => r.active) || rows[0] || null;
    }

    async function ensureDefaultProvider() {
      const rows = await db.all('provider_configs');
      if (rows.length) return;
      const s = (await db.get('settings', 'user_settings')) || {};
      const providerId = s.ai_provider || 'deepseek';
      const preset = AI_PROVIDERS[providerId] || AI_PROVIDERS.deepseek;
      const baseUrl = s.ai_base_url || preset.base_url || AI_PROVIDERS.deepseek.base_url;
      const apiKey = s.ai_api_key_encrypted ? await decryptSecret(s.ai_api_key_encrypted) : '';
      await db.insert('provider_configs', {
        user_id: 1,
        name: preset.name,
        provider_id: providerId,
        base_url: baseUrl,
        api_key_encrypted: apiKey ? await encryptSecret(apiKey) : '',
        active: 1,
        fetched_models: [],
        models: [],
        created_at: nowStr(),
        updated_at: nowStr()
      });
    }

    function providerPayload(row) {
      return {
        id: row.id,
        name: row.name,
        provider_id: row.provider_id,
        base_url: row.base_url,
        active: !!row.active,
        key_configured: !!row.api_key_encrypted,
        models: row.models || [],
        model_count: (row.models || []).length
      };
    }

    async function listProviders() {
      await ensureDefaultProvider();
      const rows = await providerRows();
      return { providers: rows.map(providerPayload) };
    }

    async function createProvider(body) {
      const providerId = String(body.provider_id || 'custom').trim() || 'custom';
      const preset = AI_PROVIDERS[providerId] || AI_PROVIDERS.custom;
      const baseUrl = String(body.base_url || '').trim() || preset.base_url || '';
      const name = String(body.name || '').trim() || preset.name || '自定义服务商';
      if (!baseUrl) throw new LocalError(4000, '请填写接口地址');
      const active = (await db.all('provider_configs')).some((r) => r.active) ? 0 : 1;
      const row = await db.insert('provider_configs', {
        user_id: 1,
        name,
        provider_id: providerId,
        base_url: baseUrl,
        api_key_encrypted: body.api_key ? await encryptSecret(String(body.api_key).trim()) : '',
        active,
        fetched_models: [],
        models: body.model ? [{ name: body.model, model: body.model }] : [],
        created_at: nowStr(),
        updated_at: nowStr()
      });
      return { id: row.id, name, active: !!active };
    }

    async function getProviderDetail(id) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      const data = providerPayload(row);
      data.key_masked = row.api_key_encrypted ? await maskKey(await decryptSecret(row.api_key_encrypted)) : '';
      data.fetched_models = row.fetched_models || [];
      data.presets = Object.entries(AI_PROVIDERS).map(([pid, preset]) => ({
        id: pid,
        name: preset.name,
        base_url: preset.base_url,
        model: preset.model
      }));
      return data;
    }

    async function updateProvider(id, body) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      if (body.name !== undefined && String(body.name).trim()) row.name = String(body.name).trim();
      if (body.base_url !== undefined) row.base_url = String(body.base_url).trim();
      if (!row.base_url) throw new LocalError(4000, '接口地址不能为空');
      if (body.api_key !== undefined && String(body.api_key).trim()) {
        row.api_key_encrypted = await encryptSecret(String(body.api_key).trim());
      }
      if (body.models !== undefined) {
        const clean = (body.models || [])
          .filter((item) => item && (item.name || item.model))
          .map((item) => ({
            name: String(item.name || item.model || '').trim(),
            model: String(item.model || '').trim()
          }));
        row.models = clean;
      }
      row.updated_at = nowStr();
      await db.put('provider_configs', row);
      return { saved: true };
    }

    async function deleteProvider(id) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      await db.delete('provider_configs', id);
      if (row.active) {
        const rows = (await db.all('provider_configs')).sort((a, b) => a.id - b.id);
        if (rows[0]) {
          rows[0].active = 1;
          rows[0].updated_at = nowStr();
          await db.put('provider_configs', rows[0]);
        }
      }
      return { deleted: true };
    }

    async function activateProvider(id) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      const rows = await db.all('provider_configs');
      for (const r of rows) {
        r.active = r.id === id ? 1 : 0;
        r.updated_at = nowStr();
        await db.put('provider_configs', r);
      }
      return { active: true };
    }

    async function revealProviderKey(id) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      return { api_key: row.api_key_encrypted ? await decryptSecret(row.api_key_encrypted) : '' };
    }

    async function setFetchedModels(id, models) {
      const row = await db.get('provider_configs', id);
      if (!row) throw new LocalError(4040, '服务商不存在');
      row.fetched_models = Array.isArray(models) ? models : [];
      row.updated_at = nowStr();
      await db.put('provider_configs', row);
      return row.fetched_models;
    }

    async function getActiveAIConfig() {
      await ensureDefaultProvider();
      const row = await getActiveProviderRow();
      if (!row || !row.api_key_encrypted) throw new LocalError(4004, '请先在设置页配置 AI API Key');
      const apiKey = await decryptSecret(row.api_key_encrypted);
      if (!apiKey) throw new LocalError(4004, 'AI API Key 解密失败，请重新配置');
      const baseUrl = row.base_url || AI_PROVIDERS.deepseek.base_url;
      const models = row.models || [];
      const model = models[0] && models[0].model ? models[0].model : '';
      if (!model) throw new LocalError(4000, '请先在服务商配置中添加并选择模型');
      return { api_key: apiKey, base_url: baseUrl, model };
    }

    async function getZoneSourceFiles(zoneId, fileIds) {
      await getZone(zoneId);
      const ids = fileIds && fileIds.length ? new Set(fileIds.map(Number)) : null;
      return (await db.where('files', (f) => f.zone_id === zoneId && (!ids || ids.has(f.id))))
        .sort((a, b) => a.id - b.id)
        .map((f) => ({
          id: f.id,
          filename: f.filename,
          content: f.content,
          kind: f.kind || 'text',
          mime_type: f.mime_type || '',
          size: f.size || 0
        }));
    }

    async function getReviewSchedule(zoneId) {
      await getZone(zoneId);
      return {
        reviews: (await db.where('review_schedule', (r) => r.zone_id === zoneId)).sort(
          (a, b) => String(a.review_date).localeCompare(String(b.review_date)) || a.id - b.id
        )
      };
    }

    async function generateCard(zoneId, point, cardData, sortOrder) {
      await getZone(zoneId);
      const files = await db.where('files', (f) => f.zone_id === zoneId);
      files.sort((a, b) => a.id - b.id);
      if (!files.length) throw new LocalError(4000, '学习区还没有文件，请先上传文件');
      const wantedId = point && point.file_id ? Number(point.file_id) : files[0].id;
      const file = files.find((f) => f.id === wantedId) || files[0];
      const fileId = file.id;
      const title = String(point.title || '').trim();
      const question = String(cardData.question || '').trim();
      if (!title || !question) return false;
      const dup = await db.where(
        'cards',
        (c) => c.file_id === fileId && c.title === title && c.question === question
      );
      if (dup.length) return false;
      await db.insert('cards', {
        file_id: fileId,
        title,
        question,
        option_a: cardData.option_a || '',
        option_b: cardData.option_b || '',
        option_c: cardData.option_c || '',
        option_d: cardData.option_d || '',
        answer: cardData.answer || '',
        explanation: cardData.explanation || '',
        label: cardData.label || '常考',
        block_name: point.block_name || '',
        difficulty: point.difficulty || '中',
        sort_order: sortOrder || 0,
        status: STATUS_TODO,
        wrong_count: 0,
        level_no: null,
        created_at: nowStr()
      });
      return true;
    }

    async function collectExportData() {
      const profile = (await db.get('settings', 'profile')) || {};
      const s = (await db.get('settings', 'user_settings')) || {};
      return {
        profile: {
          nickname: profile.nickname || '',
          daily_card_limit: s.daily_card_limit || DEFAULT_DAILY_LIMIT
        },
        zones: await db.all('zones'),
        files: await db.all('files'),
        cards: await db.all('cards'),
        records: await db.all('records'),
        zone_settings: await db.all('zone_settings'),
        levels: await db.all('levels'),
        level_cards: await db.all('level_cards'),
        review_schedule: await db.all('review_schedule'),
        daily_tasks: await db.all('daily_tasks'),
        checkins: await db.all('checkins')
      };
    }

    async function deleteZoneData(zoneId) {
      const cards = await cardsByZone(zoneId);
      await deleteCards(zoneId, cards.map((c) => c.id));
      for (const row of await db.where('files', (f) => f.zone_id === zoneId)) {
        await db.delete('files', row.id);
      }
      for (const row of await db.where('level_cards', (r) => r.zone_id === zoneId)) {
        await db.delete('level_cards', row.id);
      }
      for (const row of await db.where('levels', (r) => r.zone_id === zoneId)) {
        await db.delete('levels', row.id);
      }
      for (const row of await db.where('zone_settings', (r) => r.zone_id === zoneId)) {
        await db.delete('zone_settings', row.id);
      }
      for (const row of await db.where('checkins', (r) => r.zone_id === zoneId)) {
        await db.delete('checkins', row.id);
      }
      for (const row of await db.where('daily_tasks', (r) => r.zone_id === zoneId)) {
        await db.delete('daily_tasks', row.id);
      }
      for (const row of await db.where('review_schedule', (r) => r.zone_id === zoneId)) {
        await db.delete('review_schedule', row.id);
      }
      for (const row of await db.where('records', (r) => {
        const card = cards.find((c) => c.id === r.card_id);
        return card && card.file_id;
      })) {
        await db.delete('records', row.id);
      }
      const zone = await db.get('zones', zoneId);
      if (zone) await db.delete('zones', zoneId);
    }

    async function importData(data, filesMap, options) {
      const conflictMode = (options && options.conflictMode) || 'skip';
      const preserveProgress = !!(options && options.preserveProgress);
      const zones = data.zones || [];
      const importedZones = [];
      const skippedZones = [];
      let cardsImported = 0;
      for (const oldZone of zones) {
        const existing = (await db.where('zones', (z) => z.name === oldZone.name)).sort((a, b) => a.id - b.id)[0];
        if (existing && conflictMode === 'skip') {
          skippedZones.push(oldZone.name);
          continue;
        }
        const zoneName = existing && conflictMode === 'keep_both' ? `${oldZone.name}（导入）` : oldZone.name;
        if (existing && conflictMode === 'overwrite') {
          await deleteZoneData(existing.id);
        }
        const zoneMap = new Map();
        const fileMap = new Map();
        const cardMap = new Map();
        const levelMap = new Map();
        const newZone = await db.insert('zones', {
          user_id: 1,
          name: zoneName,
          status: oldZone.status || '进行中',
          created_at: oldZone.created_at || nowStr(),
          updated_at: nowStr()
        });
        zoneMap.set(oldZone.id, newZone.id);
        const oldFiles = (data.files || []).filter((f) => f.zone_id === oldZone.id);
        for (const oldFile of oldFiles) {
          const content = filesMap[oldFile.id] !== undefined ? filesMap[oldFile.id] : oldFile.content || '';
          const newFile = await db.insert('files', {
            zone_id: newZone.id,
            filename: oldFile.filename,
            content,
            kind: oldFile.kind || 'text',
            mime_type: oldFile.mime_type || '',
            size: oldFile.size || 0,
            created_at: oldFile.created_at || nowStr()
          });
          fileMap.set(oldFile.id, newFile.id);
        }
        const oldCards = (data.cards || []).filter((c) => fileMap.has(c.file_id));
        for (const oldCard of oldCards) {
          const newCard = await db.insert('cards', {
            file_id: fileMap.get(oldCard.file_id),
            title: oldCard.title,
            question: oldCard.question,
            option_a: oldCard.option_a,
            option_b: oldCard.option_b,
            option_c: oldCard.option_c,
            option_d: oldCard.option_d,
            answer: oldCard.answer,
            explanation: oldCard.explanation,
            label: oldCard.label || '常考',
            block_name: oldCard.block_name || '',
            difficulty: oldCard.difficulty || '中',
            sort_order: oldCard.sort_order || 0,
            status: preserveProgress ? oldCard.status || STATUS_TODO : STATUS_TODO,
            wrong_count: preserveProgress ? oldCard.wrong_count || 0 : 0,
            level_no: null,
            created_at: oldCard.created_at || nowStr()
          });
          cardMap.set(oldCard.id, newCard.id);
          cardsImported++;
        }
        const oldZoneSettings = (data.zone_settings || []).find((z) => z.zone_id === oldZone.id);
        if (oldZoneSettings) {
          await db.put('zone_settings', {
            id: newZone.id,
            zone_id: newZone.id,
            daily_limit: oldZoneSettings.daily_limit || DEFAULT_DAILY_LIMIT,
            level_count: oldZoneSettings.level_count || null,
            sort_mode: oldZoneSettings.sort_mode || SORT_EASY,
            updated_at: nowStr()
          });
        }
        if (preserveProgress) {
          const oldLevels = (data.levels || []).filter((l) => l.zone_id === oldZone.id).sort((a, b) => a.level_no - b.level_no);
          for (const oldLevel of oldLevels) {
            const newLevel = await db.insert('levels', {
              zone_id: newZone.id,
              level_no: oldLevel.level_no,
              name: oldLevel.name || '',
              level_type: oldLevel.level_type || LEVEL_TYPE_NEW,
              day_no: oldLevel.day_no,
              new_count: oldLevel.new_count || 0,
              daily_limit: oldLevel.daily_limit || DEFAULT_DAILY_LIMIT,
              status: oldLevel.status || STATUS_LEVEL_TODO,
              completed_at: oldLevel.completed_at || null,
              created_at: oldLevel.created_at || nowStr()
            });
            levelMap.set(oldLevel.id, newLevel.id);
          }
          for (const oldLc of (data.level_cards || []).filter((r) => r.zone_id === oldZone.id && cardMap.has(r.card_id))) {
            await db.put('level_cards', {
              id: `lc:${newZone.id}:${oldLc.level_no}:${cardMap.get(oldLc.card_id)}`,
              zone_id: newZone.id,
              level_no: oldLc.level_no,
              card_id: cardMap.get(oldLc.card_id),
              role: oldLc.role || ROLE_NEW,
              created_at: oldLc.created_at || nowStr()
            });
          }
          for (const oldRecord of (data.records || []).filter((r) => cardMap.has(r.card_id))) {
            await db.insert('records', {
              card_id: cardMap.get(oldRecord.card_id),
              user_id: 1,
              is_correct: oldRecord.is_correct || 0,
              level_no: oldRecord.level_no != null ? oldRecord.level_no : null,
              answered_at: oldRecord.answered_at || nowStr()
            });
          }
          for (const oldTask of (data.daily_tasks || []).filter((t) => t.zone_id === oldZone.id && cardMap.has(t.card_id))) {
            await db.insert('daily_tasks', {
              user_id: 1,
              zone_id: newZone.id,
              card_id: cardMap.get(oldTask.card_id),
              task_date: oldTask.task_date,
              status: oldTask.status || 'pending',
              position: oldTask.position || 0,
              level_no: oldTask.level_no,
              mode: oldTask.mode || MODE_DAILY,
              created_at: oldTask.created_at || nowStr()
            });
          }
          for (const oldReview of (data.review_schedule || []).filter((r) => r.zone_id === oldZone.id && cardMap.has(r.card_id))) {
            await db.put('review_schedule', {
              id: `r:1:${cardMap.get(oldReview.card_id)}:${oldReview.review_date}`,
              user_id: 1,
              zone_id: newZone.id,
              card_id: cardMap.get(oldReview.card_id),
              review_date: oldReview.review_date,
              status: oldReview.status || 'pending',
              created_at: oldReview.created_at || nowStr()
            });
          }
          for (const oldCheckin of (data.checkins || []).filter((c) => c.zone_id === oldZone.id)) {
            await db.put('checkins', {
              id: `c:${newZone.id}:${oldCheckin.checkin_date}`,
              user_id: 1,
              zone_id: newZone.id,
              checkin_date: oldCheckin.checkin_date,
              created_at: oldCheckin.created_at || nowStr()
            });
          }
        } else {
          await rebuildZoneLevels(newZone.id, null, false);
        }
        if (preserveProgress && (await db.where('levels', (l) => l.zone_id === newZone.id)).length === 0) {
          await rebuildZoneLevels(newZone.id, null, false);
        }
        importedZones.push(zoneName);
      }
      if (data.profile) {
        const profile = (await db.get('settings', 'profile')) || {};
        if (data.profile.nickname && !profile.nickname) profile.nickname = data.profile.nickname;
        await db.put('settings', { id: 'profile', ...profile });
        const s = (await db.get('settings', 'user_settings')) || {};
        if (data.profile.daily_card_limit && !s.daily_card_limit) {
          s.daily_card_limit = data.profile.daily_card_limit;
          await db.put('settings', { id: 'user_settings', ...s });
        }
      }
      return { imported_zones: importedZones.length, skipped_zones: skippedZones, cards_imported: cardsImported };
    }

    return {
      LocalError,
      AI_PROVIDERS,
      STATUS_DONE,
      STATUS_TODO,
      STATUS_REVIEW,
      STATUS_LEVEL_DONE,
      STATUS_LEVEL_TODO,
      LEVEL_TYPE_NEW,
      LEVEL_TYPE_REVIEW,
      SORT_EASY,
      SORT_BLOCK,
      nowStr,
      todayStr,
      dateAdd,
      shuffledOptions,
      computeLevelBounds,
      rebuildZoneLevels,
      deleteCards,
      getZone,
      cardsByZone,
      zoneLevelLimit,
      zoneSortMode,
      wrongCardIds,
      levelRows,
      levelRoleCards,
      pendingNewIds,
      dueReviewIds,
      firstActionableLevel,
      scheduleReviews,
      scheduleWrongRetry,
      syncLevelStatuses,
      hasActionableLevel,
      ensureReviewLevelForDue,
      ensureTodayTasks,

      async listZones() {
        const zones = (await db.all('zones')).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '') || b.id - a.id);
        const result = [];
        for (const zone of zones) {
          const cards = await cardsByZone(zone.id);
          const cardCount = cards.length;
          const successCount = cards.filter((c) => c.status === STATUS_DONE).length;
          result.push({
            id: zone.id,
            name: zone.name,
            status: zone.status,
            created_at: zone.created_at,
            updated_at: zone.updated_at,
            daily_limit: await zoneLevelLimit(zone.id),
            card_count: cardCount,
            success_count: successCount
          });
        }
        return { zones: result };
      },

      async createZone(name) {
        const now = nowStr();
        const clean = String(name || '').trim() || `学习区 ${new Date().getMonth() + 1}月${new Date().getDate()}日`;
        const zone = await db.insert('zones', {
          user_id: 1,
          name: clean,
          status: '进行中',
          created_at: now,
          updated_at: now
        });
        return { id: zone.id, name: clean, status: '进行中' };
      },

      async getZoneDetail(zoneId) {
        const zone = await getZone(zoneId);
        const cards = await cardsByZone(zoneId);
        const stats = {
          total: cards.length,
          success: cards.filter((c) => c.status === STATUS_DONE).length
        };
        const files = (await db.where('files', (f) => f.zone_id === zoneId)).sort((a, b) => a.id - b.id);
        const data = { ...zone };
        data.daily_limit = await zoneLevelLimit(zoneId);
        data.sort_mode = await zoneSortMode(zoneId);
        data.level_count = (await levelRows(zoneId)).length;
        data.completed_levels = (await db.where('levels', (l) => l.zone_id === zoneId && l.status === STATUS_LEVEL_DONE)).length;
        return {
          zone: data,
          stats,
          files: files.map((f) => ({
            id: f.id,
            filename: f.filename,
            created_at: f.created_at,
            size: f.size || String(f.content || '').length
          }))
        };
      },

      async updateZoneSettings(zoneId, body) {
        await getZone(zoneId);
        const zs = await db.get('zone_settings', zoneId);
        const dailyLimit =
          body.daily_card_limit !== undefined && body.daily_card_limit !== null
            ? body.daily_card_limit
            : zs && zs.daily_limit
              ? zs.daily_limit
              : await zoneLevelLimit(zoneId);
        const sortMode = body.sort_mode !== undefined ? body.sort_mode : zs && zs.sort_mode ? zs.sort_mode : SORT_EASY;
        if (sortMode !== SORT_EASY && sortMode !== SORT_BLOCK) {
          throw new LocalError(4007, '排序模式仅支持 easy_to_hard 或 block');
        }
        await db.put('zone_settings', {
          id: zoneId,
          zone_id: zoneId,
          daily_limit: dailyLimit,
          sort_mode: sortMode,
          level_count: zs && zs.level_count ? zs.level_count : null,
          updated_at: nowStr()
        });
        if (body.sort_mode !== undefined) {
          await rebuildZoneLevels(zoneId);
        }
        return { zone_id: zoneId, daily_card_limit: dailyLimit, sort_mode: sortMode };
      },

      async relayoutLevels(zoneId, levelCount) {
        await getZone(zoneId);
        const bounds = await computeLevelBounds(zoneId);
        if (bounds.upper === 0) throw new LocalError(4007, '还没有卡片，无法排版');
        if (levelCount < bounds.lower || levelCount > bounds.upper) {
          throw new LocalError(4007, `关卡数需在 ${bounds.lower} 到 ${bounds.upper} 之间`);
        }
        await rebuildZoneLevels(zoneId, levelCount);
        return { zone_id: zoneId, level_count: levelCount };
      },

      async addFile(zoneId, fileData) {
        await getZone(zoneId);
        const now = nowStr();
        const row = await db.insert('files', {
          zone_id: zoneId,
          filename: fileData.filename,
          content: fileData.content,
          kind: fileData.kind || 'text',
          mime_type: fileData.mime_type || '',
          size: fileData.size || 0,
          created_at: now
        });
        const zone = await db.get('zones', zoneId);
        zone.updated_at = now;
        await db.put('zones', zone);
        return { id: row.id, filename: row.filename, size: String(row.content).length };
      },

      async listCards(zoneId) {
        await getZone(zoneId);
        const files = await db.all('files');
        const fileMap = {};
        files.forEach((f) => {
          fileMap[f.id] = f.filename;
        });
        const cards = await cardsByZone(zoneId);
        cards.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
        return {
          cards: cards.map((c) => ({
            id: c.id,
            title: c.title,
            question: c.question,
            answer: c.answer,
            explanation: c.explanation,
            label: c.label,
            block_name: c.block_name || '',
            difficulty: c.difficulty || '中',
            sort_order: c.sort_order || 0,
            status: c.status,
            wrong_count: c.wrong_count || 0,
            created_at: c.created_at,
            filename: fileMap[c.file_id] || ''
          }))
        };
      },

      async getToday(zoneId) {
        await getZone(zoneId);
        const dateStr = todayStr();
        const limit = await zoneLevelLimit(zoneId);
        const tasks = await ensureTodayTasks(zoneId, dateStr);
        const pendingTasks = tasks.filter((t) => t.status === 'pending');
        const current = await firstActionableLevel(zoneId, dateStr);
        const completed = pendingTasks.length === 0 && !(await hasActionableLevel(zoneId, dateStr));
        const doneCount = tasks.filter((t) => t.status === 'done').length;
        const totalCount = tasks.length;
        const levelNo = current ? current.level_no : tasks.length ? tasks[0].level_no : null;
        const levelType = current ? current.level_type : null;
        let newTotal = 0;
        let newDone = 0;
        if (current && current.level_type === LEVEL_TYPE_NEW) {
          const ids = await levelRoleCards(zoneId, current.level_no, ROLE_NEW);
          if (ids.length) {
            const rows = await db.where('cards', (c) => ids.includes(c.id));
            newTotal = rows.filter((r) => r.status !== STATUS_DONE).length;
          }
          newDone = (await db.where(
            'daily_tasks',
            (t) => t.zone_id === zoneId && t.task_date === dateStr && t.level_no === current.level_no && t.status === 'done'
          )).length;
        }
        const checkedIn = !!(await db.get('checkins', `c:${zoneId}:${dateStr}`));
        const cards = [];
        for (const task of pendingTasks) {
          const card = await db.get('cards', task.card_id);
          if (!card) continue;
          const [options, answer] = shuffledOptions(card, card.wrong_count || 0, dateStr);
          cards.push({
            card_id: card.id,
            title: card.title,
            question: card.question,
            options,
            answer,
            label: card.label,
            explanation: card.explanation
          });
        }
        return {
          task_date: dateStr,
          daily_limit: limit,
          level_no: levelNo,
          level_type: levelType,
          new_total: newTotal,
          new_done: newDone,
          pending: cards,
          completed,
          done_count: doneCount,
          total_count: totalCount,
          checked_in: checkedIn
        };
      },

      async startLevel(zoneId, levelNo) {
        await getZone(zoneId);
        const dateStr = todayStr();
        const level = (await db.where('levels', (l) => l.zone_id === zoneId && l.level_no === levelNo))[0];
        if (!level) throw new LocalError(4040, '关卡不存在');
        const current = await firstActionableLevel(zoneId, dateStr);
        const mode = current && current.level_no === levelNo ? MODE_DAILY : MODE_REPLAY;
        let pending;
        let doneCount = 0;
        let totalCount = 0;
        if (mode === MODE_DAILY) {
          const tasks = await ensureTodayTasks(zoneId, dateStr);
          const levelTasks = tasks.filter((t) => t.level_no === levelNo);
          pending = levelTasks.filter((t) => t.status === 'pending');
          doneCount = levelTasks.filter((t) => t.status === 'done').length;
          totalCount = levelTasks.length;
        } else {
          const newIds = await levelRoleCards(zoneId, levelNo, ROLE_NEW);
          const reviewIds = await levelRoleCards(zoneId, levelNo, ROLE_REVIEW);
          let queueIds;
          if (!newIds.length && !reviewIds.length) {
            const rows = await db.where('cards', (c) => c.level_no === levelNo);
            queueIds = rows.map((c) => c.id).sort((a, b) => a - b);
          } else {
            queueIds = [...newIds, ...reviewIds.filter((id) => !newIds.includes(id))];
          }
          pending = queueIds.map((cardId) => ({ card_id: cardId, status: 'pending', level_no: levelNo }));
          totalCount = queueIds.length;
        }
        const cards = [];
        for (const task of pending) {
          const card = await db.get('cards', task.card_id);
          if (!card) continue;
          const [options, answer] = shuffledOptions(card, card.wrong_count || 0, dateStr);
          cards.push({
            card_id: card.id,
            title: card.title,
            question: card.question,
            options,
            answer,
            label: card.label,
            explanation: card.explanation,
            level_no: task.level_no
          });
        }
        return {
          level: {
            level_no: level.level_no,
            name: level.name,
            level_type: level.level_type,
            day_no: level.day_no,
            new_count: level.new_count,
            status: level.status
          },
          mode,
          cards,
          total_count: totalCount,
          done_count: doneCount,
          completed: !cards.length
        };
      },

      async submitAnswer(cardId, body) {
        const dateStr = todayStr();
        const now = nowStr();
        const option = String(body.option || '').trim().toUpperCase();
        const card = await db.get('cards', cardId);
        if (!card) throw new LocalError(4040, '卡片不存在');
        const file = await db.get('files', card.file_id);
        if (!file) throw new LocalError(4040, '卡片不存在');
        const zoneId = file.zone_id;
        await getZone(zoneId);
        const mode = body.mode || MODE_DAILY;
        const practice = mode === MODE_WRONG;
        const replay = mode === MODE_REPLAY;
        let task = null;
        if (!practice && !replay) {
          task = (
            await db.where(
              'daily_tasks',
              (t) => t.user_id === 1 && t.zone_id === zoneId && t.card_id === cardId && t.task_date === dateStr && t.mode === MODE_DAILY
            )
          ).sort((a, b) => a.id - b.id)[0];
          if (!task || task.status !== 'pending') throw new LocalError(4090, '该卡片不在今日任务中或已完成');
          if (body.level_no != null && task.level_no != null && task.level_no !== body.level_no) {
            throw new LocalError(4090, '关卡上下文不匹配');
          }
        }
        const levelNo = task ? task.level_no : body.level_no != null ? body.level_no : card.level_no || null;
        const wrongCount = card.wrong_count || 0;
        const [, displayedAnswer] = shuffledOptions(card, wrongCount, dateStr);
        const correct = option === displayedAnswer;
        let nextOptions = null;
        let nextAnswer = null;
        let cardStatus = card.status;
        await db.insert('records', {
          card_id: cardId,
          user_id: 1,
          is_correct: correct ? 1 : 0,
          level_no: levelNo,
          answered_at: now
        });
        if (correct) {
          if (!replay) {
            if (task) {
              task.status = 'done';
              await db.put('daily_tasks', task);
            }
            if (!practice) {
              if (card.status !== STATUS_DONE) {
                card.status = STATUS_DONE;
                cardStatus = STATUS_DONE;
                await db.put('cards', card);
              }
              await scheduleReviews(zoneId, cardId, dateStr, now);
              const remaining = (await cardsByZone(zoneId)).filter((c) => c.status !== STATUS_DONE).length;
              if (remaining === 0) {
                const zone = await db.get('zones', zoneId);
                zone.status = '已完成';
                zone.updated_at = now;
                await db.put('zones', zone);
              }
            }
          }
          await syncLevelStatuses(zoneId, dateStr, now);
        } else {
          if (!replay) {
            card.wrong_count = wrongCount + 1;
            await db.put('cards', card);
            if (!practice) {
              const wrongToday = (await db.where(
                'records',
                (r) => r.card_id === cardId && r.user_id === 1 && r.is_correct === 0 && String(r.answered_at).slice(0, 10) === dateStr
              )).length;
              if (wrongToday >= 3) {
                card.status = STATUS_REVIEW;
                cardStatus = STATUS_REVIEW;
                await db.put('cards', card);
              }
              await scheduleWrongRetry(zoneId, cardId, dateStr, now);
            }
            if (task) {
              const others = (
                await db.where(
                  'daily_tasks',
                  (t) => t.zone_id === zoneId && t.task_date === dateStr && t.status === 'pending' && t.id !== task.id
                )
              ).sort((a, b) => a.position - b.position || a.id - b.id);
              task.position = others.length + 1;
              await db.put('daily_tasks', task);
            }
          }
          const [nextOptionsMap, nextAnswerLetter] = shuffledOptions(card, wrongCount + 1, dateStr);
          nextOptions = nextOptionsMap;
          nextAnswer = nextAnswerLetter;
        }
        return {
          correct,
          answer: displayedAnswer,
          explanation: card.explanation,
          card_status: cardStatus,
          wrong_count: wrongCount + (correct ? 0 : 1),
          next_options: nextOptions,
          next_answer: nextAnswer,
          level_no: levelNo,
          mode
        };
      },

      async getWrongCards(zoneId) {
        await getZone(zoneId);
        const records = await db.all('records');
        const cards = await cardsByZone(zoneId);
        const cardMap = {};
        cards.forEach((c) => {
          cardMap[c.id] = c;
        });
        const group = {};
        records
          .filter((r) => r.is_correct === 0 && cardMap[r.card_id])
          .forEach((r) => {
            (group[r.card_id] = group[r.card_id] || []).push(r);
          });
        const wrongCards = Object.entries(group)
          .map(([id, rows]) => {
            const c = cardMap[Number(id)];
            return {
              id: c.id,
              title: c.title,
              question: c.question,
              option_a: c.option_a,
              option_b: c.option_b,
              option_c: c.option_c,
              option_d: c.option_d,
              answer: c.answer,
              explanation: c.explanation,
              label: c.label,
              status: c.status,
              wrong_count: c.wrong_count,
              wrong_times: rows.length,
              last_wrong: rows.map((r) => r.answered_at).sort().slice(-1)[0]
            };
          })
          .sort((a, b) => String(b.last_wrong).localeCompare(String(a.last_wrong)));
        return { wrong_cards: wrongCards };
      },

      async batchDeleteCards(cardIds) {
        const ids = unique(cardIds);
        const files = await db.all('files');
        const cards = await db.all('cards');
        const byZone = {};
        ids.forEach((id) => {
          const card = cards.find((c) => c.id === id);
          if (card) {
            const file = files.find((f) => f.id === card.file_id);
            if (file) {
              (byZone[file.zone_id] = byZone[file.zone_id] || []).push(id);
            }
          }
        });
        const missing = ids.filter((id) => !Object.values(byZone).flat().includes(id));
        if (missing.length) throw new LocalError(4040, '部分卡片不存在');
        let total = 0;
        for (const [zoneId, zoneCardIds] of Object.entries(byZone)) {
          await getZone(Number(zoneId));
          total += await deleteCards(Number(zoneId), zoneCardIds);
          await rebuildZoneLevels(Number(zoneId), null, true);
        }
        return { deleted: total };
      },

      async batchReviewCards(cardIds) {
        const ids = unique(cardIds);
        const dateStr = todayStr();
        const now = nowStr();
        const files = await db.all('files');
        const cards = await db.all('cards');
        const byZone = {};
        ids.forEach((id) => {
          const card = cards.find((c) => c.id === id);
          if (card) {
            const file = files.find((f) => f.id === card.file_id);
            if (file) {
              (byZone[file.zone_id] = byZone[file.zone_id] || []).push(id);
            }
          }
        });
        if (ids.some((id) => !Object.values(byZone).flat().includes(id))) {
          throw new LocalError(4040, '部分卡片不存在');
        }
        let added = 0;
        for (const [zoneIdStr, zoneCardIds] of Object.entries(byZone)) {
          const zoneId = Number(zoneIdStr);
          await getZone(zoneId);
          const current = await firstActionableLevel(zoneId, dateStr);
          const levelNo = current ? current.level_no : null;
          for (const cardId of zoneCardIds) {
            const task = (
              await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.card_id === cardId && t.task_date === dateStr)
            ).sort((a, b) => a.id - b.id)[0];
            const tasks = await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr);
            const maxPos = tasks.reduce((m, t) => Math.max(m, t.position || 0), 0);
            if (task && task.status === 'pending') continue;
            if (task) {
              task.status = 'pending';
              task.position = maxPos + 1;
              task.level_no = levelNo;
              task.mode = MODE_DAILY;
              await db.put('daily_tasks', task);
            } else {
              await db.insert('daily_tasks', {
                user_id: 1,
                zone_id: zoneId,
                card_id: cardId,
                task_date: dateStr,
                status: 'pending',
                position: maxPos + 1,
                level_no: levelNo,
                mode: MODE_DAILY,
                created_at: now
              });
            }
            added++;
          }
        }
        return { added, total: ids.length };
      },

      async getWrongPractice(zoneId) {
        await getZone(zoneId);
        const dateStr = todayStr();
        const wrongIds = await wrongCardIds(zoneId);
        const cards = [];
        for (const id of wrongIds) {
          const card = await db.get('cards', id);
          if (!card) continue;
          const [options, answer] = shuffledOptions(card, card.wrong_count || 0, dateStr);
          cards.push({
            card_id: card.id,
            title: card.title,
            question: card.question,
            options,
            answer,
            label: card.label,
            explanation: card.explanation
          });
        }
        return { cards, total: cards.length };
      },

      async addWrongPractice(zoneId) {
        await getZone(zoneId);
        const dateStr = todayStr();
        const now = nowStr();
        const ids = await wrongCardIds(zoneId);
        let added = 0;
        for (const cardId of ids) {
          const task = (
            await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.card_id === cardId && t.task_date === dateStr)
          ).sort((a, b) => a.id - b.id)[0];
          const tasks = await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr);
          const maxPos = tasks.reduce((m, t) => Math.max(m, t.position || 0), 0);
          if (task && task.status === 'pending') continue;
          if (task) {
            task.status = 'pending';
            task.position = maxPos + 1;
            await db.put('daily_tasks', task);
          } else {
            await db.insert('daily_tasks', {
              user_id: 1,
              zone_id: zoneId,
              card_id: cardId,
              task_date: dateStr,
              status: 'pending',
              position: maxPos + 1,
              created_at: now
            });
          }
          added++;
        }
        return { added, total_wrong: ids.length };
      },

      async getProgress(zoneId) {
        await getZone(zoneId);
        const dateStr = todayStr();
        const limit = await zoneLevelLimit(zoneId);
        const cards = await cardsByZone(zoneId);
        const total = cards.length;
        const done = cards.filter((c) => c.status === STATUS_DONE).length;
        let levelCount = (await levelRows(zoneId)).length;
        if (!levelCount) {
          await rebuildZoneLevels(zoneId);
          levelCount = (await levelRows(zoneId)).length;
        }
        const now = nowStr();
        await syncLevelStatuses(zoneId, dateStr, now);
        await ensureReviewLevelForDue(zoneId, dateStr, now);
        const levels = await levelRows(zoneId);
        const totalLevels = total > 0 ? Math.max(1, levels.length) : 0;
        const completedLevels = levels.filter((l) => l.status === STATUS_LEVEL_DONE).length;
        const actionable = await firstActionableLevel(zoneId, dateStr);
        const currentRow = actionable || levels.find((l) => l.status === STATUS_LEVEL_TODO) || null;
        const currentLevel = currentRow ? currentRow.level_no : totalLevels;
        const levelPath = [];
        for (const lv of levels) {
          const newIds = await levelRoleCards(zoneId, lv.level_no, ROLE_NEW);
          const reviewIds = await levelRoleCards(zoneId, lv.level_no, ROLE_REVIEW);
          let allIds = unique([...newIds, ...reviewIds]);
          if (!allIds.length) {
            const rows = await db.where('cards', (c) => c.level_no === lv.level_no);
            allIds = rows.map((c) => c.id).sort((a, b) => a - b);
            newIds.length = 0;
            newIds.push(...allIds);
          }
          const newSet = new Set(newIds);
          const reviewSet = new Set(reviewIds);
          let blockName = '';
          if (newIds.length) {
            const rows = await db.where('cards', (c) => newIds.includes(c.id) && c.block_name);
            const first = rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)[0];
            blockName = first ? first.block_name : '';
          }
          const cardRows = await db.where('cards', (c) => allIds.includes(c.id));
          const cardCount = cardRows.length;
          const doneCards = cardRows.filter((r) => r.status === STATUS_DONE).length;
          const newTotal = cardRows.filter((r) => newSet.has(r.id) && r.status !== STATUS_DONE).length;
          let newDone = 0;
          if (newIds.length) {
            newDone = (await db.where(
              'daily_tasks',
              (t) => t.zone_id === zoneId && t.task_date === dateStr && t.level_no === lv.level_no && t.status === 'done' && newIds.includes(t.card_id)
            )).length;
          }
          let dueReviews = 0;
          let nextReview = null;
          if (reviewSet.size) {
            const rows = await db.where(
              'review_schedule',
              (r) => r.zone_id === zoneId && r.status === 'pending' && r.review_date <= dateStr && reviewIds.includes(r.card_id)
            );
            dueReviews = unique(rows.map((r) => r.card_id)).length;
            const pendingRows = await db.where(
              'review_schedule',
              (r) => r.zone_id === zoneId && r.status === 'pending' && reviewIds.includes(r.card_id)
            );
            const minDate = pendingRows.map((r) => r.review_date).sort()[0];
            nextReview = minDate || null;
          }
          levelPath.push({
            level_no: lv.level_no,
            name: lv.name,
            block_name: blockName,
            level_type: lv.level_type,
            day_no: lv.day_no,
            new_count: lv.new_count,
            status: lv.status,
            daily_limit: lv.daily_limit,
            card_count: cardCount,
            done_cards: doneCards,
            new_total: newTotal,
            new_done: newDone,
            due_reviews: dueReviews,
            next_review: nextReview,
            completed_at: lv.completed_at
          });
        }
        const tasks = await db.where('daily_tasks', (t) => t.zone_id === zoneId && t.task_date === dateStr);
        const pendingCnt = tasks.filter((t) => t.status === 'pending').length;
        const moreLevels = levels.some((l) => l.status === STATUS_LEVEL_TODO);
        const todayDone =
          !(await hasActionableLevel(zoneId, dateStr)) || (tasks.length > 0 && tasks.every((t) => t.status === 'done') && !moreLevels);
        const reviewToday = unique(
          (
            await db.where(
              'review_schedule',
              (r) => r.zone_id === zoneId && r.review_date <= dateStr && r.status === 'pending'
            )
          ).map((r) => r.card_id)
        ).length;
        const bounds = await computeLevelBounds(zoneId);
        const zs = await db.get('zone_settings', zoneId);
        let selected = zs && zs.level_count ? zs.level_count : null;
        if (selected !== null && bounds.upper > 0) selected = Math.max(bounds.lower, Math.min(bounds.upper, selected));
        let todayNewTotal = 0;
        let todayNewDone = 0;
        if (actionable && actionable.level_type === LEVEL_TYPE_NEW) {
          const pathLevel = levelPath.find((lv) => lv.level_no === actionable.level_no);
          todayNewTotal = pathLevel ? pathLevel.new_total : 0;
          todayNewDone = pathLevel ? pathLevel.new_done : 0;
        }
        const checkedToday = !!(await db.get('checkins', `c:${zoneId}:${dateStr}`));
        let streak = 0;
        for (let d = dateStr; ; ) {
          if (await db.get('checkins', `c:${zoneId}:${d}`)) {
            streak++;
            d = dateAdd(d, -1);
          } else {
            break;
          }
        }
        const week = [];
        for (let i = 6; i >= 0; i--) {
          const ds = dateAdd(dateStr, -i);
          week.push({ date: ds, checked: !!(await db.get('checkins', `c:${zoneId}:${ds}`)) });
        }
        return {
          total_cards: total,
          done_cards: done,
          daily_limit: limit,
          sort_mode: await zoneSortMode(zoneId),
          total_levels: totalLevels,
          completed_levels: completedLevels,
          new_levels: levels.filter((l) => l.level_type === LEVEL_TYPE_NEW).length,
          review_levels: levels.filter((l) => l.level_type === LEVEL_TYPE_REVIEW).length,
          current_level: currentLevel,
          levels: levelPath,
          layout: { ...bounds, selected },
          today_pending: pendingCnt,
          today_done: todayDone,
          today_new_total: todayNewTotal,
          today_new_done: todayNewDone,
          review_today: reviewToday,
          checked_today: checkedToday,
          streak,
          week
        };
      },

      getSettings,
      updateSettings,
      listProviders,
      createProvider,
      getProviderDetail,
      updateProvider,
      deleteProvider,
      activateProvider,
      revealProviderKey,
      setFetchedModels,
      getActiveAIConfig,
      encryptSecret,
      decryptSecret,
      getZoneSourceFiles,
      getReviewSchedule,
      generateCard,
      collectExportData,
      deleteZoneData,
      importData
    };
  }

  return { create: createCore, LocalError, AI_PROVIDERS, REVIEW_INTERVALS };
});
