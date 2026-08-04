// Local-first API layer: same surface as the old backend API, backed by IndexedDB.
const LocalCoreInstance = LocalCore.create(LocalDB);
const LocalAIInstance = LocalAI.create(LocalCoreInstance);

const ALLOWED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.cpp',
  '.h',
  '.py',
  '.pdf',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp'
]);
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};

function parsePath(url) {
  return String(url)
    .split('?')[0]
    .split('/')
    .filter(Boolean);
}

function queryParams(url) {
  const q = String(url).split('?')[1] || '';
  return new URLSearchParams(q);
}

function toApiError(err) {
  if (err && err.name === 'LocalError') return new Error(err.message);
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(blob);
  });
}

async function readUploadFile(file) {
  const filename = file.name || 'unnamed.txt';
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const e = new LocalCoreInstance.LocalError(
      4006,
      `不支持的文件类型：${ext || '未知'}，仅支持 ${Array.from(ALLOWED_EXTENSIONS).sort().join(', ')}`
    );
    throw e;
  }
  const buffer = await file.arrayBuffer();
  let content = '';
  let kind = 'text';
  let mimeType = '';
  if (ext === '.docx') {
    try {
      content = await LocalDocx.extractText(buffer);
    } catch (err) {
      throw new LocalCoreInstance.LocalError(4006, err.message || 'Word 解析失败，请上传有效的 .docx 文件');
    }
  } else if (ext === '.pdf') {
    try {
      content = await LocalPdf.extractText(buffer);
    } catch (err) {
      throw new LocalCoreInstance.LocalError(4006, 'PDF 解析失败，请上传可复制文本的 PDF');
    }
  } else if (IMAGE_MIME[ext]) {
    kind = 'image';
    mimeType = IMAGE_MIME[ext];
    content = await blobToDataUrl(new Blob([buffer], { type: mimeType }));
  } else {
    content = new TextDecoder('utf-8').decode(buffer);
    if (content.includes('\uFFFD')) {
      try {
        content = new TextDecoder('gb18030').decode(buffer);
      } catch (err) {
        // keep the utf-8 result
      }
    }
  }
  content = content.trim();
  if (!content) {
    throw new LocalCoreInstance.LocalError(4006, '文件中没有可读取的文本内容');
  }
  return { filename, content, kind, mime_type: mimeType, size: file.size };
}

let writeQueue = Promise.resolve();
function withLock(fn) {
  const run = writeQueue.catch(() => {}).then(() => fn());
  writeQueue = run.catch(() => {});
  return run;
}

const LocalAPI = {
  core: LocalCoreInstance,
  ai: LocalAIInstance,

  async route(method, url, body) {
    const parts = parsePath(url);
    const doRoute = async () => {
      if (parts[0] !== 'api') throw new Error('未知接口');
      const p = parts.slice(1);

      if (p[0] === 'me' && method === 'GET') {
          const settings = await LocalCoreInstance.getSettings();
          return { user: { id: 1, email: 'local@user', nickname: settings.nickname }, settings };
        }

        if (p[0] === 'auth') return { ok: true };

        if (p[0] === 'zones') {
          const zoneId = p[1] ? Number(p[1]) : null;
          if (!zoneId) {
            if (method === 'GET') return LocalCoreInstance.listZones();
            if (method === 'POST') return LocalCoreInstance.createZone(body && body.name);
            throw new Error('不支持的请求');
          }
          const sub = p[2];
          if (!sub) {
            if (method === 'DELETE') return LocalCoreInstance.deleteZone(zoneId);
            return LocalCoreInstance.getZoneDetail(zoneId);
          }
          if (sub === 'pin' && method === 'POST') {
            return LocalCoreInstance.setZonePinned(zoneId, !!(body && body.pinned));
          }
          if (sub === 'settings' && method === 'PUT') {
            return LocalCoreInstance.updateZoneSettings(zoneId, body || {});
          }
          if (sub === 'levels' && p[3] === 'layout' && method === 'PUT') {
            return LocalCoreInstance.relayoutLevels(zoneId, body && body.level_count);
          }
          if (sub === 'files' && method === 'POST') {
            const file = body && body.file;
            if (!file) throw new Error('缺少上传文件');
            const data = await readUploadFile(file);
            return LocalCoreInstance.addFile(zoneId, data);
          }
          if (sub === 'analyze' && method === 'POST') {
            const fileIds = (body && body.file_ids) || [];
            return {
              knowledge_points: await LocalAIInstance.analyzeZone(
                zoneId,
                body && body.onProgress,
                fileIds,
                body && body.speedRef
              )
            };
          }
          if (sub === 'generate' && method === 'POST') {
            const replaceOld = (body && body.replace_old) || 'none';
            if (replaceOld === 'all') {
              const cards = await LocalCoreInstance.listCards(zoneId);
              const ids = cards.cards.map((c) => c.id);
              await LocalCoreInstance.batchDeleteCards(ids);
            } else if (replaceOld === 'selected') {
              await LocalCoreInstance.batchDeleteCards((body && body.delete_card_ids) || []);
            }
            const points = body && body.blocks !== undefined ? body.blocks : body && body.knowledge_points;
            const result = await LocalAIInstance.generateCards(
              zoneId,
              points || [],
              body && body.onProgress,
              body && body.speedRef
            );
            await LocalCoreInstance.rebuildZoneLevels(zoneId, null, true);
            return result;
          }
          if (sub === 'cards' && method === 'GET') return LocalCoreInstance.listCards(zoneId);
          if (sub === 'library' && method === 'GET') {
            const kind = queryParams(url).get('kind') || 'quiz';
            const q = queryParams(url).get('q') || '';
            return LocalCoreInstance.listLibraryCards(zoneId, kind, q);
          }
          if (sub === 'today' && method === 'GET') return LocalCoreInstance.getToday(zoneId);
          if (sub === 'wrong-cards' && method === 'GET') {
            const kind = queryParams(url).get('kind') || 'quiz';
            return LocalCoreInstance.getWrongCards(zoneId, kind);
          }
          if (sub === 'wrong-practice') {
            const kind = queryParams(url).get('kind') || 'quiz';
            if (method === 'GET') return LocalCoreInstance.getWrongPractice(zoneId, kind);
            if (method === 'POST') return LocalCoreInstance.addWrongPractice(zoneId, kind);
          }
          if (sub === 'progress' && method === 'GET') return LocalCoreInstance.getProgress(zoneId);
          if (sub === 'ai-history') {
            if (p[3] && method === 'GET') return LocalCoreInstance.getAIHistory(p[3]);
            if (method === 'GET') return LocalCoreInstance.listAIHistory(zoneId);
            if (method === 'POST') {
              return LocalCoreInstance.saveAIHistory(zoneId, (body && body.type) || 'analyze', (body && body.payload) || {});
            }
          }
          if (sub === 'levels' && p[3] && p[4] === 'start' && method === 'GET') {
            return LocalCoreInstance.startLevel(zoneId, Number(p[3]));
          }
          if (sub === 'refine' && p[3]) {
            if (p[3] === 'analyze' && method === 'POST') {
              return LocalAIInstance.refineAnalyze(
                zoneId,
                body && body.onProgress,
                (body && body.file_ids) || [],
                body && body.speedRef
              );
            }
            if (p[3] === 'extend' && method === 'POST') {
              return LocalAIInstance.refineExtend(zoneId, (body && body.points) || [], body || {});
            }
            if (p[3] === 'decompose' && method === 'POST') {
              return LocalAIInstance.refineDecompose(zoneId, (body && body.points) || [], body || {});
            }
          }
          throw new Error('未知学习区接口');
        }

        if (p[0] === 'cards') {
          if (p[1] === 'toggle-favorite' && method === 'POST') {
            return LocalCoreInstance.toggleFavorite(
              Number(body && body.zone_id),
              body && body.kind,
              body && body.card_id
            );
          }
          if (p[1] === 'reorder' && method === 'POST') {
            return LocalCoreInstance.reorderLibraryCards(
              Number(body && body.zone_id),
              body && body.kind,
              (body && body.card_ids) || []
            );
          }
          if (p[1] === 'delete' && method === 'POST') {
            return LocalCoreInstance.deleteLibraryCards(
              Number(body && body.zone_id),
              body && body.kind,
              (body && body.card_ids) || [],
              !!(body && body.with_pair)
            );
          }
          if (p[1] === 'study' && method === 'POST') {
            return LocalCoreInstance.studyCards(
              Number(body && body.zone_id),
              body && body.kind,
              (body && body.card_ids) || []
            );
          }
          if (p[1] === 'batch-delete' && method === 'POST') {
            return LocalCoreInstance.batchDeleteCards((body && body.card_ids) || []);
          }
          if (p[1] === 'batch-review' && method === 'POST') {
            return LocalCoreInstance.batchReviewCards((body && body.card_ids) || []);
          }
          const cardId = p[1] ? Number(p[1]) : null;
          if (cardId && p[2] === 'answer' && method === 'POST') {
            return LocalCoreInstance.submitAnswer(cardId, body || {});
          }
          const memoryId = p[1];
          if (memoryId && p[2] === 'memory-answer' && method === 'POST') {
            return LocalCoreInstance.submitMemoryAnswer(memoryId, body || {});
          }
          throw new Error('未知卡片接口');
        }

        if (p[0] === 'calendar') {
          if (method === 'GET') {
            const zoneId = queryParams(url).get('zone_id');
            return LocalCoreInstance.getCalendar(zoneId ? [Number(zoneId)] : []);
          }
          if (method === 'PUT') return LocalCoreInstance.updateCalendarSettings(body || {});
        }

        if (p[0] === 'settings') {
          if (!p[1]) {
            if (method === 'GET') return LocalCoreInstance.getSettings();
            if (method === 'PUT') return LocalCoreInstance.updateSettings(body || {});
          }
          if (p[1] === 'test-ai' && method === 'POST') {
            const bodyData = body || {};
            let config;
            try {
              config = await LocalCoreInstance.getActiveAIConfig();
            } catch (err) {
              if (!bodyData.ai_api_key) throw err;
              config = {
                api_key: bodyData.ai_api_key,
                base_url: bodyData.ai_base_url || 'https://api.deepseek.com',
                model: bodyData.ai_model || 'deepseek-chat'
              };
            }
            if (bodyData.ai_api_key) config.api_key = bodyData.ai_api_key;
            if (bodyData.ai_base_url) config.base_url = bodyData.ai_base_url;
            if (bodyData.ai_model) config.model = bodyData.ai_model;
            return LocalAIInstance.testConnection(config.api_key, config.base_url, config.model);
          }
          throw new Error('未知设置接口');
        }

        if (p[0] === 'providers') {
          const providerId = p[1] ? Number(p[1]) : null;
          if (!providerId) {
            if (method === 'GET') return LocalCoreInstance.listProviders();
            if (method === 'POST') return LocalCoreInstance.createProvider(body || {});
            throw new Error('不支持的请求');
          }
          const action = p[2];
          if (!action) {
            if (method === 'GET') return LocalCoreInstance.getProviderDetail(providerId);
            if (method === 'PUT') return LocalCoreInstance.updateProvider(providerId, body || {});
            if (method === 'DELETE') return LocalCoreInstance.deleteProvider(providerId);
          }
          if (action === 'activate' && method === 'POST') {
            return LocalCoreInstance.activateProvider(providerId);
          }
          if (action === 'reveal-key' && method === 'POST') {
            return LocalCoreInstance.revealProviderKey(providerId);
          }
          if (action === 'fetch-models' && method === 'POST') {
            const detail = await LocalCoreInstance.getProviderDetail(providerId);
            if (!detail.key_configured) {
              throw new LocalCoreInstance.LocalError(4000, '请先填写并保存 API Key，再获取模型');
            }
            const revealed = await LocalCoreInstance.revealProviderKey(providerId);
            const connection = queryParams(url).get('connection') || 'direct';
            const channel = connection === 'proxy' ? '代理' : '直连';
            try {
              const models = await LocalAIInstance.listModels(revealed.api_key, detail.base_url, 15000);
              if (!models.length) throw new Error('官方接口未返回任何模型');
              await LocalCoreInstance.setFetchedModels(providerId, models);
              return { count: models.length, models, source: 'api', channel, note: '成功获取模型' };
            } catch (err) {
              throw new LocalCoreInstance.LocalError(4005, `获取模型失败（${channel}）：${err.message || err}`);
            }
          }
          if (action === 'test' && method === 'POST') {
            const detail = await LocalCoreInstance.getProviderDetail(providerId);
            if (!detail.key_configured) throw new LocalCoreInstance.LocalError(4000, '请先填写并保存 API Key');
            const revealed = await LocalCoreInstance.revealProviderKey(providerId);
            const models = detail.models || [];
            const model = models[0] && models[0].model;
            if (!model) throw new LocalCoreInstance.LocalError(4000, '请先添加并选择模型');
            return LocalAIInstance.testConnection(revealed.api_key, detail.base_url, model);
          }
          throw new Error('未知服务商接口');
        }

        throw new Error('未知接口：' + url);
    };

    try {
      if (method === 'GET') return await doRoute();
      return await withLock(doRoute);
    } catch (err) {
      throw toApiError(err);
    }
  },

  async exportBackup() {
    return LocalExport.buildFullZip(LocalCoreInstance);
  },

  async importBackup(file, options) {
    const buffer = await file.arrayBuffer();
    const parsed = await LocalImport.parseZip(buffer);
    return LocalCoreInstance.importData(parsed.data, parsed.filesMap, options || {});
  },

  async lastExportInfo() {
    const s = await LocalDB.get('settings', 'last_export');
    return s || null;
  },

  async markExported() {
    await LocalDB.put('settings', { id: 'last_export', exported_at: new Date().toISOString() });
  }
};

// Kept for the original view modules.
const API = {
  request(method, url, body = null) {
    return LocalAPI.route(method, url, body);
  },
  get(url) {
    return this.request('GET', url);
  },
  post(url, body) {
    return this.request('POST', url, body);
  },
  put(url, body) {
    return this.request('PUT', url, body);
  },
  delete(url) {
    return this.request('DELETE', url);
  },
  upload(url, file) {
    return this.request('POST', url, { file });
  },
  exportBackup: LocalAPI.exportBackup.bind(LocalAPI),
  importBackup: LocalAPI.importBackup.bind(LocalAPI),
  lastExportInfo: LocalAPI.lastExportInfo.bind(LocalAPI),
  markExported: LocalAPI.markExported.bind(LocalAPI)
};
