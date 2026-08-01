// Settings module - profile, AI providers, and local backup
const Settings = {
  presets: [],
  providerId: null,
  provider: null,
  fetchedModels: [],
  keyShown: false,
  importFile: null,

  async render() {
    const tpl = document.getElementById('tpl-settings');
    App.setPage(tpl);

    document.getElementById('btn-back-home-set').onclick = () => App.navigate('home');
    document.getElementById('btn-add-provider').onclick = () => this.showAddProviderModal();
    document.getElementById('btn-export-backup').onclick = () => this.handleExportBackup();
    const importInput = document.getElementById('import-file-input');
    importInput.addEventListener('change', () => {
      this.importFile = importInput.files && importInput.files[0];
      if (this.importFile) this.showImportModal();
    });
    document.getElementById('btn-import-backup').onclick = () => {
      if (window.desktopAPI && window.desktopAPI.isDesktop) this.importFromDesktop();
      else importInput.click();
    };

    try {
      const [data, provData] = await Promise.all([
        API.get('/api/settings'),
        API.get('/api/providers')
      ]);
      this.presets = data.providers || [];
      document.getElementById('set-nickname').value = data.nickname || '';
      document.getElementById('set-daily-limit').value = data.daily_card_limit || 5;
      document.getElementById('btn-save-profile').onclick = () => this.saveProfile();
      this.renderProviderList(provData.providers || []);
      this.renderBackupInfo();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  async renderBackupInfo() {
    const el = document.getElementById('backup-info');
    if (!el) return;
    try {
      const info = await API.lastExportInfo();
      if (info && info.exported_at) {
        const days = Math.floor((Date.now() - new Date(info.exported_at).getTime()) / 86400000);
        el.textContent = days <= 1
          ? '最近已导出备份，数据保存在本机。'
          : `上次导出备份是 ${days} 天前，建议定期导出防止数据丢失。`;
      } else {
        el.textContent = '还没有导出过备份，建议首次使用后立即导出。';
      }
    } catch (e) {
      el.textContent = '本地备份状态读取失败。';
    }
  },

  async saveProfile() {
    const body = {
      nickname: document.getElementById('set-nickname').value.trim(),
      daily_card_limit: parseInt(document.getElementById('set-daily-limit').value, 10) || 5
    };
    try {
      await API.put('/api/settings', body);
      Toast.show('个人设置已保存', 'success');
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  renderProviderList(list) {
    const el = document.getElementById('provider-list');
    const empty = document.getElementById('provider-empty');
    if (!list.length) {
      el.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    el.innerHTML = list.map((p) => `
      <div class="provider-card ${p.active ? 'active' : ''}">
        <div class="provider-head">
          <span class="provider-name">${Utils.esc(p.name)}</span>
          <span class="provider-badge ${p.active ? 'badge-active' : 'badge-inactive'}">${p.active ? '已启动' : '未启动'}</span>
        </div>
        <div class="provider-meta">${Utils.esc(p.base_url)} · 模型 ${p.model_count || 0} 个</div>
        <div class="provider-actions">
          <button class="btn btn-outline btn-sm" data-act="config" data-id="${p.id}">配置</button>
          <button class="btn btn-outline btn-sm" data-act="activate" data-id="${p.id}" ${p.active ? 'disabled' : ''}>启动</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-id="${p.id}">删除</button>
        </div>
      </div>
    `).join('');
    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.onclick = () => this.handleProviderAction(btn.dataset.act, parseInt(btn.dataset.id, 10));
    });
  },

  handleProviderAction(act, id) {
    if (act === 'config') App.navigate('settings', id);
    else if (act === 'activate') this.activateProvider(id);
    else if (act === 'delete') this.confirmDelete(id);
  },

  async activateProvider(id) {
    try {
      await API.post(`/api/providers/${id}/activate`);
      Toast.show('已启动该服务商', 'success');
      this.render();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  confirmDelete(id) {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3>删除服务商</h3>
      <p style="font-size:0.9rem;color:#64748b;margin-bottom:16px;">删除后需要重新配置，确定删除吗？</p>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">取消</button>
        <button class="btn btn-danger btn-sm" id="modal-confirm">删除</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      modal.classList.add('hidden');
      try {
        await API.delete(`/api/providers/${id}`);
        Toast.show('已删除', 'success');
        this.render();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  },

  showAddProviderModal() {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    const list = this.presets.length ? this.presets : [{ id: 'custom', name: '自定义', base_url: '', model: '' }];
    const options = list.map((p) => `<option value="${Utils.esc(p.id)}">${Utils.esc(p.name)}</option>`).join('');
    box.innerHTML = `
      <h3>添加服务商</h3>
      <div class="form-group">
        <label>模板</label>
        <select id="add-provider-template">${options}</select>
      </div>
      <div class="form-group">
        <label>名称</label>
        <input type="text" id="add-provider-name" placeholder="例如：我的 DeepSeek">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">创建</button>
      </div>
    `;
    modal.classList.remove('hidden');
    const tplSelect = document.getElementById('add-provider-template');
    const nameInput = document.getElementById('add-provider-name');
    tplSelect.onchange = () => {
      const preset = list.find((p) => p.id === tplSelect.value);
      if (preset && !nameInput.value.trim()) nameInput.value = preset.name;
    };
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      const preset = list.find((p) => p.id === tplSelect.value) || {};
      const body = {
        provider_id: tplSelect.value,
        name: nameInput.value.trim() || preset.name || '自定义服务商',
        base_url: preset.base_url || ''
      };
      modal.classList.add('hidden');
      try {
        const data = await API.post('/api/providers', body);
        Toast.show('服务商已创建', 'success');
        App.navigate('settings', data.id);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  },

  async renderDetail(id) {
    this.providerId = id;
    this.keyShown = false;
    const tpl = document.getElementById('tpl-provider-detail');
    App.setPage(tpl);

    document.getElementById('btn-back-providers').onclick = () => App.navigate('settings');
    document.getElementById('btn-toggle-key').onclick = () => this.toggleKey();
    document.getElementById('btn-fetch-models').onclick = () => this.fetchModels();
    document.getElementById('btn-add-model').onclick = () => this.addModelRows();
    document.getElementById('btn-save-provider').onclick = () => this.saveProvider();
    document.getElementById('btn-activate-provider').onclick = () => this.activateProvider(id);
    document.getElementById('btn-test-provider').onclick = () => this.testProvider();
    document.getElementById('btn-delete-provider').onclick = () => this.confirmDelete(id);
    document.getElementById('btn-template-sample').onclick = () => this.fillTemplateSample();
    document.getElementById('btn-template-apply').onclick = () => this.applyTemplate();

    const presetSelect = document.getElementById('p-preset');
    presetSelect.onchange = () => {
      const preset = this.presets.find((p) => p.id === presetSelect.value);
      if (preset && preset.base_url) {
        document.getElementById('p-base-url').value = preset.base_url;
      }
      this.toggleCustomTemplate(presetSelect.value === 'custom');
    };

    try {
      const [detail, settings] = await Promise.all([
        API.get(`/api/providers/${id}`),
        API.get('/api/settings')
      ]);
      this.provider = detail;
      this.fetchedModels = detail.fetched_models || [];
      this.presets = detail.presets || settings.providers || [];
      document.getElementById('provider-detail-title').textContent = detail.name || '服务商配置';
      document.getElementById('provider-active-badge').textContent = detail.active ? '已启动' : '未启动';
      document.getElementById('provider-active-badge').className = 'provider-active-badge ' + (detail.active ? 'active' : '');
      document.getElementById('p-name').value = detail.name || '';
      document.getElementById('p-base-url').value = detail.base_url || '';
      document.getElementById('p-key-hint').textContent = detail.key_configured
        ? `已配置(${detail.key_masked || ''})，点击“显示”可查看`
        : '尚未配置';
      if (detail.key_configured) {
        try {
          const keyData = await API.post(`/api/providers/${this.providerId}/reveal-key`);
          if (keyData.api_key) document.getElementById('p-api-key').value = keyData.api_key;
        } catch (e) {
          // 回显失败不阻塞页面，仍可手动输入或点击“显示”获取
        }
      }
      presetSelect.innerHTML = this.presets.map((p) => `<option value="${Utils.esc(p.id)}">${Utils.esc(p.name)}</option>`).join('');
      presetSelect.value = detail.provider_id || 'custom';
      this.toggleCustomTemplate(presetSelect.value === 'custom');
      this.renderModelRows(detail.models && detail.models.length ? detail.models : []);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  toggleCustomTemplate(show) {
    const section = document.getElementById('custom-template-section');
    if (section) section.classList.toggle('hidden', !show);
  },

  fillTemplateSample() {
    document.getElementById('template-json').value = JSON.stringify({
      name: '我的自定义服务商',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-你的密钥',
      models: ['model-a', 'model-b']
    }, null, 2);
  },

  applyTemplate() {
    const raw = document.getElementById('template-json').value.trim();
    if (!raw) {
      Toast.show('请先粘贴模板 JSON', 'error');
      return;
    }
    let tpl;
    try {
      tpl = JSON.parse(raw);
    } catch (e) {
      Toast.show('JSON 格式错误：' + e.message, 'error');
      return;
    }
    if (typeof tpl !== 'object' || tpl === null) {
      Toast.show('模板必须是 JSON 对象', 'error');
      return;
    }
    const name = String(tpl.name || tpl.providerName || tpl.provider_name || '').trim();
    const baseUrl = String(tpl.base_url || tpl.baseURL || tpl.url || tpl.api_base || tpl.apiBase || '').trim();
    const apiKey = String(tpl.api_key || tpl.apiKey || tpl.key || '').trim();
    if (name) document.getElementById('p-name').value = name;
    if (baseUrl) document.getElementById('p-base-url').value = baseUrl;
    if (apiKey) document.getElementById('p-api-key').value = apiKey;
    Toast.show('模板已应用，点击“保存配置”生效', 'success');
  },

  renderModelRows(rows) {
    const container = document.getElementById('model-rows');
    const list = rows && rows.length ? rows : [];
    container.innerHTML = list.map((row, i) => `
      <div class="model-row" data-index="${i}">
        <input type="text" class="model-alias" value="${Utils.esc(row.name || '')}" placeholder="自定义名称">
        <select class="model-select">${this.modelOptions(row.model)}</select>
        <button class="btn-icon btn-remove-model" title="删除此行">×</button>
      </div>
    `).join('');
    const empty = document.getElementById('model-empty');
    if (empty) empty.classList.toggle('hidden', list.length > 0);
    container.querySelectorAll('.btn-remove-model').forEach((btn) => {
      btn.onclick = () => {
        btn.closest('.model-row').remove();
        const emptyEl = document.getElementById('model-empty');
        if (emptyEl) emptyEl.classList.toggle('hidden', !!container.querySelector('.model-row'));
      };
    });
  },

  emptyModelRow() {
    const first = this.fetchedModels[0] || '';
    return { name: '', model: first };
  },

  modelOptions(selected) {
    const list = Array.from(new Set(this.fetchedModels || []));
    const opts = list.map((m) => `<option value="${Utils.esc(m)}" ${m === selected ? 'selected' : ''}>${Utils.esc(m)}</option>`).join('');
    const placeholder = `<option value="" disabled ${selected ? '' : 'selected'}>选择模型</option>`;
    return placeholder + opts;
  },

  collectModelRows() {
    const rows = [];
    document.querySelectorAll('#model-rows .model-row').forEach((wrap) => {
      const name = wrap.querySelector('.model-alias').value.trim();
      const model = wrap.querySelector('.model-select').value.trim();
      if (name || model) rows.push({ name: name || model, model });
    });
    return rows;
  },

  addModelRows() {
    const input = document.getElementById('add-model-count');
    const n = Math.max(1, Math.min(20, parseInt(input ? input.value : '1', 10) || 1));
    const current = this.collectModelRows();
    for (let i = 0; i < n; i++) current.push(this.emptyModelRow());
    this.renderModelRows(current);
  },

  async toggleKey() {
    const input = document.getElementById('p-api-key');
    const btn = document.getElementById('btn-toggle-key');
    if (this.keyShown) {
      this.keyShown = false;
      input.type = 'password';
      btn.textContent = '显示';
      return;
    }
    try {
      if (!input.value) {
        const data = await API.post(`/api/providers/${this.providerId}/reveal-key`);
        input.value = data.api_key || '';
      }
      this.keyShown = true;
      input.type = 'text';
      btn.textContent = '隐藏';
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  async fetchModels() {
    const btn = document.getElementById('btn-fetch-models');
    const resultEl = document.getElementById('fetch-result');
    const saveResult = await this.saveProvider(true);
    if (!saveResult.ok) {
      resultEl.className = 'ai-test-result show error';
      resultEl.textContent = saveResult.message;
      return;
    }
    btn.disabled = true;
    btn.textContent = '获取中...';
    resultEl.className = 'ai-test-result show pending';
    resultEl.textContent = '正在直连官方接口...';

    const direct = await this.fetchModelsOnce('direct');
    if (direct.ok) {
      this.showFetchSuccess(direct.data, '直连', resultEl);
      btn.disabled = false;
      btn.textContent = '获取模型';
      return;
    }
    if (direct.message.includes('API Key')) {
      resultEl.className = 'ai-test-result show error';
      resultEl.textContent = direct.message;
      btn.disabled = false;
      btn.textContent = '获取模型';
      return;
    }

    resultEl.textContent = '直连失败，正在尝试代理连接...';
    const proxy = await this.fetchModelsOnce('proxy');
    if (proxy.ok) {
      this.showFetchSuccess(proxy.data, '代理', resultEl);
    } else {
      resultEl.className = 'ai-test-result show error';
      resultEl.textContent = `直连失败：${direct.message}；代理失败：${proxy.message}`;
    }
    btn.disabled = false;
    btn.textContent = '获取模型';
  },

  async fetchModelsOnce(connection) {
    try {
      const data = await API.post(`/api/providers/${this.providerId}/fetch-models?connection=${connection}`);
      this.fetchedModels = data.models || [];
      return { ok: true, data };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  showFetchSuccess(data, channel, resultEl) {
    const message = `成功获取模型（${channel}），共 ${data.count || 0} 个`;
    resultEl.className = 'ai-test-result show success';
    resultEl.textContent = message;
    Toast.show(message, 'success');
    this.renderModelRows(this.collectModelRows());
  },

  async saveProvider(silent = false) {
    const body = {
      name: document.getElementById('p-name').value.trim(),
      base_url: document.getElementById('p-base-url').value.trim(),
      models: this.collectModelRows()
    };
    const key = document.getElementById('p-api-key').value.trim();
    if (key) body.api_key = key;
    try {
      await API.put(`/api/providers/${this.providerId}`, body);
      document.getElementById('provider-detail-title').textContent = body.name;
      document.getElementById('p-key-hint').textContent = key
        ? `已配置(****${key.slice(-4)})，点击“显示”可查看`
        : document.getElementById('p-key-hint').textContent;
      if (!silent) Toast.show('配置已保存，密钥仅保存在本机', 'success');
      return { ok: true };
    } catch (e) {
      if (!silent) Toast.show(e.message, 'error');
      return { ok: false, message: e.message };
    }
  },

  async testProvider() {
    const btn = document.getElementById('btn-test-provider');
    const resultEl = document.getElementById('provider-test-result');
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.className = 'ai-test-result show pending';
    resultEl.textContent = '正在请求 AI 服务...';
    try {
      const data = await API.post(`/api/providers/${this.providerId}/test`);
      resultEl.className = 'ai-test-result show success';
      resultEl.innerHTML = `✔ 连接成功（${data.latency}s）：${Utils.esc(data.reply || 'OK')}`;
    } catch (e) {
      resultEl.className = 'ai-test-result show error';
      resultEl.innerHTML = `✘ ${Utils.esc(e.message)}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  },

  async handleExportBackup() {
    try {
      const { blob, filename } = await API.exportBackup();
      if (window.desktopAPI && window.desktopAPI.isDesktop) {
        const data = await blob.arrayBuffer();
        await window.desktopAPI.saveZip(filename, data);
      } else {
        LocalExport.downloadBlob(blob, filename);
      }
      await API.markExported();
      Toast.show('备份已导出，文件名：' + filename, 'success');
      this.renderBackupInfo();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  async importFromDesktop() {
    try {
      const result = await window.desktopAPI.openZip();
      if (!result || result.canceled) return;
      this.importFile = new File([result.data], result.name, { type: 'application/zip' });
      this.showImportModal();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  showImportModal() {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3>导入备份</h3>
      <p style="font-size:0.9rem;color:#64748b;margin-bottom:12px;">同名学习区的处理方式</p>
      <div class="import-option-list">
        <label><input type="radio" name="import-conflict" value="overwrite" checked> 覆盖同名学习区</label>
        <label><input type="radio" name="import-conflict" value="keep_both"> 保留两份（自动改名）</label>
        <label><input type="radio" name="import-conflict" value="skip"> 跳过同名学习区</label>
      </div>
      <label class="import-preserve">
        <input type="checkbox" id="import-preserve-progress" checked> 保留原学习进度
      </label>
      <p style="font-size:0.8rem;color:#94a3b8;margin:8px 0;">取消勾选将重新闯关，原进度不导入。</p>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">开始导入</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      const conflictMode = document.querySelector('input[name="import-conflict"]:checked').value;
      const preserveProgress = document.getElementById('import-preserve-progress').checked;
      const btn = document.getElementById('modal-confirm');
      btn.disabled = true;
      btn.textContent = '导入中...';
      try {
        const result = await API.importBackup(this.importFile, { conflictMode, preserveProgress });
        modal.classList.add('hidden');
        Toast.show(
          `导入完成：${result.imported_zones} 个学习区，${result.cards_imported} 张卡片`,
          'success'
        );
        if (result.skipped_zones && result.skipped_zones.length) {
          Toast.show('已跳过：' + result.skipped_zones.join('、'), 'error');
        }
        document.getElementById('import-file-input').value = '';
        App.navigate('home');
      } catch (e) {
        Toast.show(e.message, 'error');
        btn.disabled = false;
        btn.textContent = '开始导入';
      }
    };
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  }
};
