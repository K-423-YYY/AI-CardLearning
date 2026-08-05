// Sync Settings Page — WebDAV cloud sync
const SyncSettings = {
  syncInstance: null,

  PRESETS: [
    { name: '坚果云', url: 'https://dav.jianguoyun.com/dav/' },
    { name: 'TeraCloud', url: 'https://xxxx.teracloud.jp/dav/' },
    { name: 'InfiniCLOUD', url: 'https://xxxx.infini-cloud.net/dav/' },
    { name: 'Box.com', url: 'https://dav.box.com/dav/' },
    { name: 'NextCloud', url: 'https://your-server.com/remote.php/dav/' },
    { name: '群晖 NAS', url: 'https://your-nas:5006/' },
    { name: '自定义', url: '' }
  ],

  async render() {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="page"><header class="topbar"><button class="btn-icon btn-back" id="btn-sync-back">←</button><div class="topbar-title">云盘同步</div><div style="width:40px"></div></header><main class="main-content"><div id="sync-content"></div></main></div>';
    document.getElementById('btn-sync-back').onclick = () => App.navigate('settings');
    this.syncInstance = Sync.create(LocalCoreInstance);
    this.renderContent();
  },

  async renderContent() {
    const el = document.getElementById('sync-content');
    const sync = this.syncInstance;
    const config = (await sync.getConfig()) || {};
    const status = await sync.getSyncStatus();

    el.innerHTML = `
      <div class="settings-section">
        <h3>☁ WebDAV 配置</h3>
        <p class="form-hint">选择你的云盘服务并填写账号密码。数据将通过 WebDAV 协议在多设备间同步。</p>
        <div class="form-group">
          <label>云盘服务</label>
          <select id="sync-preset" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem">${this.PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label>WebDAV 地址</label>
          <input type="url" id="sync-url" placeholder="https://dav.jianguoyun.com/dav/" value="${Utils.esc(config.url || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem">
        </div>
        <div class="form-group">
          <label>用户名</label>
          <input type="text" id="sync-username" placeholder="WebDAV 用户名" value="${Utils.esc(config.username || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem">
        </div>
        <div class="form-group">
          <label>密码</label>
          <div style="display:flex;gap:8px">
            <input type="password" id="sync-password" placeholder="WebDAV 密码" value="${Utils.esc(config.password || '')}" style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem">
            <button class="btn btn-outline btn-sm" id="btn-toggle-sync-pwd">显示</button>
          </div>
        </div>
        <div class="form-group">
          <label>设备名称</label>
          <input type="text" id="sync-device-name" placeholder="我的电脑" value="${Utils.esc(config.deviceName || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem" maxlength="30">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-outline" id="btn-test-sync">测试连接</button>
          <button class="btn btn-primary" id="btn-save-sync">保存配置</button>
        </div>
        <div id="sync-test-result" style="margin-top:12px;font-size:13px" class="hidden"></div>
      </div>

      <div class="settings-section">
        <h3>同步操作</h3>
        <div id="sync-status-text" style="font-size:13px;color:#64748b;margin-bottom:10px">${status.configured ? (status.status === 'connected' ? '上次同步：' + (status.remoteTime || '未知') : '云端暂无数据') : '请先配置连接'}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-block" id="btn-push">上传到云端</button>
          <button class="btn btn-outline btn-block" id="btn-pull">从云端下载</button>
        </div>
        <button class="btn btn-primary btn-block" id="btn-sync-now" style="margin-top:8px">立即同步</button>
        <div class="form-group" style="margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">
          <label>自动同步</label>
          <select id="sync-auto-interval" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem">
            <option value="0" ${config.autoSyncMinutes ? '' : 'selected'}>关闭</option>
            <option value="5" ${config.autoSyncMinutes === 5 ? 'selected' : ''}>每 5 分钟</option>
            <option value="15" ${config.autoSyncMinutes === 15 ? 'selected' : ''}>每 15 分钟</option>
            <option value="30" ${config.autoSyncMinutes === 30 ? 'selected' : ''}>每 30 分钟</option>
            <option value="60" ${config.autoSyncMinutes === 60 ? 'selected' : ''}>每 1 小时</option>
          </select>
        </div>
      </div>
    `;

    this.bindEvents();
    document.getElementById('sync-preset').onchange = () => {
      const preset = this.PRESETS[parseInt(document.getElementById('sync-preset').value)];
      if (preset) document.getElementById('sync-url').value = preset.url;
    };
  },

  bindEvents() {
    const sync = this.syncInstance;
    document.getElementById('btn-toggle-sync-pwd').onclick = () => {
      const input = document.getElementById('sync-password');
      const btn = document.getElementById('btn-toggle-sync-pwd');
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '隐藏'; }
      else { input.type = 'password'; btn.textContent = '显示'; }
    };
    document.getElementById('btn-save-sync').onclick = async () => {
      try {
        await sync.saveConfig({
          url: document.getElementById('sync-url').value.trim(),
          username: document.getElementById('sync-username').value.trim(),
          password: document.getElementById('sync-password').value.trim(),
          deviceName: document.getElementById('sync-device-name').value.trim() || '未命名设备',
          autoSyncMinutes: parseInt(document.getElementById('sync-auto-interval').value) || 0
        });
        const mins = parseInt(document.getElementById('sync-auto-interval').value) || 0;
        await sync.enableAutoSync(mins);
        Toast.show('配置已保存', 'success');
        this.renderContent();
      } catch (e) { Toast.show(e.message, 'error'); }
    };
    document.getElementById('btn-test-sync').onclick = async () => {
      const resultEl = document.getElementById('sync-test-result');
      resultEl.classList.remove('hidden');
      resultEl.textContent = '测试中...';
      resultEl.style.color = '#f59e0b';
      try {
        const result = await sync.testConnection(
          document.getElementById('sync-url').value.trim(),
          document.getElementById('sync-username').value.trim(),
          document.getElementById('sync-password').value.trim()
        );
        resultEl.textContent = (result.ok ? '✔ ' : '✘ ') + result.message;
        resultEl.style.color = result.ok ? '#10b981' : '#ef4444';
      } catch (e) {
        resultEl.textContent = '✘ ' + e.message;
        resultEl.style.color = '#ef4444';
      }
    };
    document.getElementById('btn-push').onclick = async () => {
      const btn = document.getElementById('btn-push');
      btn.disabled = true; btn.textContent = '上传中...';
      try { await sync.push((s, m) => { document.getElementById('sync-status-text').textContent = m; }); Toast.show('上传完成', 'success'); this.renderContent(); }
      catch (e) { Toast.show(e.message, 'error'); }
      btn.disabled = false; btn.textContent = '上传到云端';
    };
    document.getElementById('btn-pull').onclick = async () => {
      const btn = document.getElementById('btn-pull');
      btn.disabled = true; btn.textContent = '下载中...';
      try { const r = await sync.pull((s, m) => { document.getElementById('sync-status-text').textContent = m; }); Toast.show('同步完成: ' + (r.imported_zones || 0) + ' 个学习区', 'success'); this.renderContent(); }
      catch (e) { Toast.show(e.message, 'error'); }
      btn.disabled = false; btn.textContent = '从云端下载';
    };
    document.getElementById('btn-sync-now').onclick = async () => {
      const btn = document.getElementById('btn-sync-now');
      btn.disabled = true; btn.textContent = '同步中...';
      try { await sync.sync((s, m) => { document.getElementById('sync-status-text').textContent = m; }); Toast.show('同步完成', 'success'); this.renderContent(); }
      catch (e) { Toast.show(e.message, 'error'); }
      btn.disabled = false; btn.textContent = '立即同步';
    };
  }
};
