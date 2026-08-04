// Cloud Sync Module — WebDAV-based data synchronization
// Syncs learning data between devices via WebDAV protocol (坚果云, NextCloud, ownCloud, etc.)
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Sync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const SYNC_PATH = 'ai-learn-sync';
  const MANIFEST_FILE = 'manifest.json';
  const DATA_FILE = 'sync-data.json';
  const FILES_DIR = 'files';

  // WebDAV client
  async function webdavRequest(method, path, body, config, isBinary) {
    const base = String(config.url || '').replace(/\/+$/, '');
    const url = `${base}/${path}`;
    const headers = {};
    // Basic auth
    if (config.username && config.password) {
      headers['Authorization'] = 'Basic ' + btoa(config.username + ':' + config.password);
    } else if (config.token) {
      headers['Authorization'] = 'Bearer ' + config.token;
    }
    if (body && !isBinary) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    const opts = { method, headers };
    if (body) opts.body = isBinary ? body : JSON.stringify(body, null, 2);
    const res = await fetch(url, opts);
    return res;
  }

  function create(core) {

    // ── Configuration ──
    async function getConfig() {
      try {
        const row = await core._db ? await core._db.get('settings', 'sync_config') : null;
        if (!row) return null;
        // Decrypt password
        let password = '';
        if (row.password_encrypted && core.decryptSecret) {
          password = await core.decryptSecret(row.password_encrypted);
        }
        return {
          url: row.url || '',
          username: row.username || '',
          password: password,
          autoSyncMinutes: row.auto_sync_minutes || 0,
          deviceName: row.device_name || '未命名设备',
          deviceId: row.device_id || ''
        };
      } catch (e) {
        return null;
      }
    }

    async function saveConfig(config) {
      const db = core._db || (typeof LocalDB !== 'undefined' ? LocalDB : null);
      if (!db) return;
      let passwordEncrypted = '';
      if (config.password && core.encryptSecret) {
        passwordEncrypted = await core.encryptSecret(config.password);
      }
      const row = {
        id: 'sync_config',
        url: config.url || '',
        username: config.username || '',
        password_encrypted: passwordEncrypted,
        auto_sync_minutes: config.autoSyncMinutes || 0,
        device_name: config.deviceName || '未命名设备',
        device_id: config.deviceId || generateDeviceId(),
        updated_at: new Date().toISOString()
      };
      await db.put('settings', row);
    }

    function generateDeviceId() {
      let id = '';
      try { id = localStorage.getItem('ai-learn-device-id') || ''; } catch (e) { }
      if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        try { localStorage.setItem('ai-learn-device-id', id); } catch (e) { }
      }
      return id;
    }

    // ── Test Connection ──
    async function testConnection(url, username, password) {
      try {
        const config = { url, username, password };
        const res = await webdavRequest('PROPFIND', '', null, config);
        if (res.ok) {
          return { ok: true, message: '连接成功' };
        }
        if (res.status === 401) {
          return { ok: false, message: '认证失败：用户名或密码错误' };
        }
        if (res.status === 404) {
          return { ok: false, message: '路径不存在，请检查 WebDAV 地址' };
        }
        return { ok: false, message: `连接失败：HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, message: `网络错误：${e.message}` };
      }
    }

    // ── Ensure sync directory exists ──
    async function ensureSyncDir(config) {
      try {
        let res = await webdavRequest('PROPFIND', SYNC_PATH, null, config);
        if (res.status === 404) {
          await webdavRequest('MKCOL', SYNC_PATH, null, config);
          await webdavRequest('MKCOL', `${SYNC_PATH}/${FILES_DIR}`, null, config);
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    // ── Push: Local → Remote ──
    async function push(onProgress) {
      const config = await getConfig();
      if (!config || !config.url) throw new Error('请先配置云同步连接');
      reportProgress(onProgress, 'connecting', '正在连接云盘…');

      await ensureSyncDir(config);

      reportProgress(onProgress, 'collecting', '正在收集本地数据…');
      const exportData = await core.collectExportData();
      const deviceId = config.deviceId || generateDeviceId();

      const syncPayload = {
        format_version: 1,
        device_id: deviceId,
        device_name: config.deviceName || '未命名设备',
        pushed_at: new Date().toISOString(),
        data: exportData
      };

      reportProgress(onProgress, 'uploading', '正在上传数据…');
      const res = await webdavRequest('PUT', `${SYNC_PATH}/${DATA_FILE}`, syncPayload, config);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`上传失败：HTTP ${res.status} ${text.slice(0, 100)}`);
      }

      // Upload manifest
      const manifest = {
        format_version: 1,
        last_sync_version: Date.now(),
        last_sync_at: new Date().toISOString(),
        last_device_id: deviceId,
        last_device_name: config.deviceName || ''
      };
      await webdavRequest('PUT', `${SYNC_PATH}/${MANIFEST_FILE}`, manifest, config);

      reportProgress(onProgress, 'done', '上传完成');
      return { ok: true, pushedAt: syncPayload.pushed_at };
    }

    // ── Pull: Remote → Local ──
    async function pull(onProgress) {
      const config = await getConfig();
      if (!config || !config.url) throw new Error('请先配置云同步连接');

      reportProgress(onProgress, 'connecting', '正在连接云盘…');
      const res = await webdavRequest('GET', `${SYNC_PATH}/${DATA_FILE}`, null, config);

      if (res.status === 404) {
        throw new Error('云端没有同步数据，请先上传一次');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`下载失败：HTTP ${res.status} ${text.slice(0, 100)}`);
      }

      reportProgress(onProgress, 'downloading', '正在下载数据…');
      const syncPayload = await res.json();

      if (!syncPayload.data) {
        throw new Error('云端数据格式无效');
      }

      reportProgress(onProgress, 'importing', '正在导入数据…');
      const result = await core.importData(syncPayload.data, {}, {
        conflictMode: 'overwrite',
        preserveProgress: true
      });

      reportProgress(onProgress, 'done', `导入完成：${result.imported_zones} 个学习区，${result.cards_imported} 张卡片`);
      return { ok: true, ...result, pulledFrom: syncPayload.device_name || '未知设备' };
    }

    // ── Sync (bi-directional) ──
    async function sync(onProgress) {
      const config = await getConfig();
      if (!config || !config.url) throw new Error('请先配置云同步连接');

      await ensureSyncDir(config);

      try {
        // Check remote manifest
        reportProgress(onProgress, 'checking', '正在检查云端版本…');
        let remoteManifest = null;
        try {
          const res = await webdavRequest('GET', `${SYNC_PATH}/${MANIFEST_FILE}`, null, config);
          if (res.ok) remoteManifest = await res.json();
        } catch (e) { /* may not exist yet */ }

        if (!remoteManifest) {
          // No remote data — just push
          reportProgress(onProgress, 'first-sync', '首次同步 — 上传本地数据…');
          return await push(onProgress);
        }

        // Compare timestamps — last-write-wins
        const deviceId = config.deviceId || generateDeviceId();
        const now = Date.now();

        // Both push and pull
        reportProgress(onProgress, 'push', '正在上传本地变更…');
        await push((s, m) => reportProgress(onProgress, 'push-' + s, m));

        reportProgress(onProgress, 'pull', '正在下载远程变更…');
        const pullResult = await pull((s, m) => reportProgress(onProgress, 'pull-' + s, m));

        reportProgress(onProgress, 'done', `同步完成：${pullResult.imported_zones || 0} 个学习区`);
        return { ok: true, ...pullResult };
      } catch (e) {
        reportProgress(onProgress, 'error', e.message);
        throw e;
      }
    }

    // ── Auto-sync scheduler ──
    let autoSyncTimer = null;

    async function enableAutoSync(minutes) {
      disableAutoSync();
      const config = await getConfig();
      if (config) {
        config.autoSyncMinutes = minutes;
        await saveConfig(config);
      }
      if (minutes > 0) {
        autoSyncTimer = setInterval(() => {
          sync((status, msg) => {
            console.log('[auto-sync]', status, msg);
          }).catch(() => {});
        }, minutes * 60000);
      }
    }

    function disableAutoSync() {
      if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
      }
    }

    function getAutoSyncStatus() {
      return !!autoSyncTimer;
    }

    // ── Get sync status for UI ──
    async function getSyncStatus() {
      const config = await getConfig();
      if (!config || !config.url) {
        return { configured: false, status: 'unconfigured', message: '未配置' };
      }
      let remoteInfo = null;
      try {
        const res = await webdavRequest('GET', `${SYNC_PATH}/${MANIFEST_FILE}`, null, config);
        if (res.ok) remoteInfo = await res.json();
      } catch (e) { /* offline */ }

      return {
        configured: true,
        status: remoteInfo ? 'connected' : 'no-remote',
        message: remoteInfo
          ? `上次同步：${formatTimeAgo(remoteInfo.last_sync_at)}`
          : '云端暂无数据',
        remoteDevice: remoteInfo ? remoteInfo.last_device_name : null,
        remoteTime: remoteInfo ? remoteInfo.last_sync_at : null,
        autoSync: config.autoSyncMinutes > 0,
        autoSyncInterval: config.autoSyncMinutes
      };
    }

    function formatTimeAgo(isoStr) {
      if (!isoStr) return '未知';
      const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
      if (diff < 60) return '刚刚';
      if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
      if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
      return Math.floor(diff / 86400) + ' 天前';
    }

    function reportProgress(cb, status, message) {
      if (typeof cb === 'function') {
        try { cb(status, message); } catch (e) { /* ignore */ }
      }
    }

    return {
      getConfig, saveConfig,
      testConnection,
      push, pull, sync,
      enableAutoSync, disableAutoSync, getAutoSyncStatus,
      getSyncStatus
    };
  }

  return { create };
});
