// Sync Settings Page — WebDAV configuration and manual sync controls
const SyncSettings = {
  syncInstance: null,

  async render() {
    const tpl = document.getElementById('tpl-sync');
    if (tpl) {
      App.setPage(tpl);
    } else {
      const app = document.getElementById('app');
      app.innerHTML = `
        <div class="page" id="sync-page">
          <div class="settings-grid">
            <div class="card sync-config" id="sync-config-card">
              <div class="card-header"><span class="card-title">☁ WebDAV 云同步</span></div>
              <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:16px">
                支持坚果云、NextCloud、ownCloud、群晖 NAS 等 WebDAV 服务。学习数据将通过云盘在多设备间同步。
              </p>
              <div class="form-group">
                <label class="form-label">WebDAV 地址</label>
                <input class="form-input" id="sync-url" type="url" placeholder="https://dav.jianguoyun.com/dav/" autocomplete="url">
              </div>
              <div class="form-group">
                <label class="form-label">用户名</label>
                <input class="form-input" id="sync-username" type="text" placeholder="WebDAV 用户名" autocomplete="username">
              </div>
              <div class="form-group">
                <label class="form-label">密码</label>
                <div style="display:flex;gap:8px">
                  <input class="form-input" id="sync-password" type="password" placeholder="WebDAV 密码" autocomplete="current-password" style="flex:1">
                  <button class="btn btn-outline btn-sm" id="btn-toggle-sync-pwd">显示</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">设备名称</label>
                <input class="form-input" id="sync-device-name" type="text" placeholder="我的电脑" maxlength="30">
              </div>
              <div style="display:flex;gap:8px;margin-top:12px">
                <button class="btn btn-outline" id="btn-test-sync">测试连接</button>
                <button class="btn btn-primary" id="btn-save-sync">保存配置</button>
              </div>
              <div id="sync-test-result" style="margin-top:12px;font-size:13px" class="hidden"></div>
            </div>

            <div class="card" id="sync-actions-card">
              <div class="card-header"><span class="card-title">同步操作</span></div>
              <div id="sync-status-bar" class="sync-status-bar hidden"></div>
              <div style="display:flex;gap:8px;margin-top:12px">
                <button class="btn btn-outline btn-block" id="btn-push">上传到云端</button>
                <button class="btn btn-outline btn-block" id="btn-pull">从云端下载</button>
              </div>
              <button class="btn btn-primary btn-block" id="btn-sync-now" style="margin-top:8px">立即同步</button>

              <div class="form-group" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border-light)">
                <label class="form-label">自动同步</label>
                <select class="form-select" id="sync-auto-interval">
                  <option value="0">关闭</option>
                  <option value="5">每 5 分钟</option>
                  <option value="15">每 15 分钟</option>
                  <option value="30">每 30 分钟</option>
                  <option value="60">每 1 小时</option>
                </select>
              </div>

              <div class="sync-history" id="sync-history">
                <div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);margin-top:12px">同步记录</div>
                <div id="sync-history-list" style="margin-top:8px">
                  <div class="sync-history-item">
                    <span style="color:var(--color-text-tertiary)">暂无同步记录</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    this.syncInstance = Sync.create(LocalCoreInstance);
    await this.loadConfig();
    this.bindEvents();
  },

  async loadConfig() {
    const sync = this.syncInstance;
    if (!sync) return;
    const config = await sync.getConfig();
    if (config) {
      setVal('sync-url', config.url);
      setVal('sync-username', config.username);
      setVal('sync-password', config.password);
      setVal('sync-device-name', config.deviceName);
      setVal('sync-auto-interval', String(config.autoSyncMinutes || 0));
    }
    await this.updateStatus();
  },

  async updateStatus() {
    const sync = this.syncInstance;
    if (!sync) return;
    try {
      const status = await sync.getSyncStatus();
      const bar = document.getElementById('sync-status-bar');
      if (bar && status.configured) {
        bar.classList.remove('hidden');
        bar.className = 'sync-status-bar sync-status-bar ' + (status.status === 'connected' ? 'synced' : 'pending');
        bar.textContent = status.message;
      }
      // Update sidebar sync indicator
      const dot = document.getElementById('sidebar-sync-dot');
      const text = document.getElementById('sidebar-sync-text');
      if (dot && text) {
        dot.className = 'sidebar-sync-dot ' + (status.status === 'connected' ? '' : 'offline');
        text.textContent = status.status === 'connected' ? '已同步' : '本地模式';
      }
      const badge = document.getElementById('sync-status-badge');
      if (badge) {
        badge.textContent = status.status === 'connected' ? '☁ 已同步' : '● 本地模式';
      }
    } catch (e) { /* ignore */ }
  },

  bindEvents() {
    const sync = this.syncInstance;

    // Toggle password visibility
    on('btn-toggle-sync-pwd', 'click', () => {
      const input = document.getElementById('sync-password');
      const btn = document.getElementById('btn-toggle-sync-pwd');
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '隐藏'; }
      else { input.type = 'password'; btn.textContent = '显示'; }
    });

    // Save config
    on('btn-save-sync', 'click', async () => {
      const config = {
        url: getVal('sync-url'),
        username: getVal('sync-username'),
        password: getVal('sync-password'),
        deviceName: getVal('sync-device-name') || '未命名设备',
        autoSyncMinutes: parseInt(getVal('sync-auto-interval')) || 0
      };
      if (!config.url) { Toast.show('请输入 WebDAV 地址', 'error'); return; }
      try {
        await sync.saveConfig(config);
        Toast.show('配置已保存', 'success');
        await this.updateStatus();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    });

    // Test connection
    on('btn-test-sync', 'click', async () => {
      const url = getVal('sync-url');
      const username = getVal('sync-username');
      const password = getVal('sync-password');
      if (!url) { Toast.show('请输入 WebDAV 地址', 'error'); return; }
      const resultEl = document.getElementById('sync-test-result');
      resultEl.classList.remove('hidden');
      resultEl.textContent = '正在测试连接…';
      resultEl.style.color = 'var(--color-warning)';
      const btn = document.getElementById('btn-test-sync');
      btn.disabled = true; btn.textContent = '测试中…';
      try {
        const result = await sync.testConnection(url, username, password);
        resultEl.textContent = result.ok ? '✔ ' + result.message : '✘ ' + result.message;
        resultEl.style.color = result.ok ? 'var(--color-success)' : 'var(--color-danger)';
      } catch (e) {
        resultEl.textContent = '✘ ' + e.message;
        resultEl.style.color = 'var(--color-danger)';
      }
      btn.disabled = false; btn.textContent = '测试连接';
    });

    // Push
    on('btn-push', 'click', async () => {
      const btn = document.getElementById('btn-push');
      btn.disabled = true; btn.textContent = '上传中…';
      try {
        const result = await sync.push((status, msg) => {
          const bar = document.getElementById('sync-status-bar');
          if (bar) { bar.classList.remove('hidden'); bar.textContent = msg; }
        });
        Toast.show('上传完成', 'success');
        await this.updateStatus();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
      btn.disabled = false; btn.textContent = '上传到云端';
    });

    // Pull
    on('btn-pull', 'click', async () => {
      const btn = document.getElementById('btn-pull');
      btn.disabled = true; btn.textContent = '下载中…';
      try {
        const result = await sync.pull((status, msg) => {
          const bar = document.getElementById('sync-status-bar');
          if (bar) { bar.classList.remove('hidden'); bar.textContent = msg; }
        });
        Toast.show('同步完成：' + (result.imported_zones || 0) + ' 个学习区', 'success');
        await this.updateStatus();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
      btn.disabled = false; btn.textContent = '从云端下载';
    });

    // Sync now
    on('btn-sync-now', 'click', async () => {
      const btn = document.getElementById('btn-sync-now');
      btn.disabled = true; btn.textContent = '同步中…';
      try {
        await sync.sync((status, msg) => {
          const bar = document.getElementById('sync-status-bar');
          if (bar) { bar.classList.remove('hidden'); bar.textContent = msg; }
        });
        Toast.show('同步完成', 'success');
        await this.updateStatus();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
      btn.disabled = false; btn.textContent = '立即同步';
    });

    // Auto-sync interval change
    on('sync-auto-interval', 'change', async () => {
      const mins = parseInt(getVal('sync-auto-interval')) || 0;
      if (mins > 0) {
        await sync.enableAutoSync(mins);
        Toast.show(`已开启自动同步：每 ${mins} 分钟`, 'success');
      } else {
        sync.disableAutoSync();
        Toast.show('已关闭自动同步');
      }
      const config = await sync.getConfig();
      if (config) { config.autoSyncMinutes = mins; await sync.saveConfig(config); }
    });
  }
};

// Helpers
function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}
