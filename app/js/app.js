const APP_VERSION = '0.2.0';

const Utils = {
  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(String(dateStr).replace(' ', 'T') + '+08:00');
    if (isNaN(d)) return String(dateStr).slice(0, 10);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    const days = Math.floor(diff / 86400);
    if (days < 30) return days + '天前';
    return String(dateStr).slice(0, 10);
  },

  formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};

const Modal = {
  show(html) {
    const el = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = html;
    el.classList.remove('hidden');
    // Backdrop click to close
    el.onclick = (e) => { if (e.target === el) this.close(); };
  },

  close() {
    const el = document.getElementById('modal');
    el.classList.add('hidden');
    el.onclick = null;
  },

  bindCancel(id) {
    const btn = document.querySelector(id || '#modal-cancel');
    if (btn) btn.onclick = () => this.close();
  },

  bindConfirm(id, handler) {
    const btn = document.querySelector(id || '#modal-confirm');
    if (btn) btn.onclick = async () => {
      try { await handler(); } catch (e) { /* caller handles */ }
    };
  }
};

const Toast = {
  _queue: [],
  _showing: false,

  show(msg, type) {
    // Deduplicate identical consecutive messages
    if (this._queue.length && this._queue[this._queue.length - 1].msg === msg) return;
    this._queue.push({ msg, type });
    if (!this._showing) this._next();
  },

  _next() {
    if (!this._queue.length) { this._showing = false; return; }
    this._showing = true;
    const { msg, type } = this._queue.shift();
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast-global show ' + (type || '');
    clearTimeout(el._tid);
    el._tid = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => this._next(), 250);
    }, 2500);
  }
};

const App = {
  currentRoute: null,
  lastHash: null,

  navigate(route, ...args) {
    const hash = '#' + route + (args.length ? '/' + args.join('/') : '');
    this.currentRoute = { route, args };
    this.lastHash = hash;
    if (location.hash !== hash) location.hash = hash;
    this._renderRoute();
  },

  _renderRoute() {
    const r = this.currentRoute;
    if (!r) return;
    switch (r.route) {
      case 'home':
        Zones.renderHome();
        break;
      case 'zone':
        Zones.renderZone(r.args[0]);
        break;
      case 'upload':
        Zones.renderUpload(r.args[0]);
        break;
      case 'ai':
        Zones.renderAi(r.args[0]);
        break;
      case 'cards':
        Zones.renderCards(r.args[0]);
        break;
      case 'level':
        Cards.renderLevel(r.args[0], r.args[1]);
        break;
      case 'learn':
        Cards.renderLearn(r.args[0]);
        break;
      case 'wrong':
        Cards.renderWrong(r.args[0]);
        break;
      case 'wrong-practice':
        Cards.renderWrongPractice(r.args[0]);
        break;
      case 'sync':
        SyncSettings.render();
        break;
      case 'settings':
        r.args.length ? Settings.renderDetail(r.args[0]) : Settings.render();
        break;
      default:
        console.warn('未知路由：' + r.route + '，返回首页');
        Zones.renderHome();
        break;
    }
    this.updateDesktopShell(r);
  },

  setPage(tpl) {
    const app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));
  },

  updateDesktopShell(r) {
    const breadcrumb = document.getElementById('desktop-breadcrumb');
    const syncBadge = document.getElementById('sync-status-badge');
    if (!breadcrumb) return; // Old shell — skip
    const titles = {
      home: ['学习总览', '管理学习区，规划每日闯关'],
      zone: ['学习区详情', '上传资料、生成卡片、查看闯关路径'],
      upload: ['上传文件', '支持文本、Markdown、C++、头文件、Python、PDF 文档'],
      ai: ['AI 趋势分析', '自动提取知识点并生成知识卡片'],
      cards: ['知识卡片', '浏览、复习或删除全部卡片'],
      level: ['关卡学习', '完成本关任务'],
      learn: ['今日闯关', '新学卡片 + 到期复习'],
      wrong: ['错题集', '集中重练答错的卡片'],
      'wrong-practice': ['错题练习', '独立复习模式'],
      settings: ['设置', '个人偏好、AI 服务商与本地备份'],
      sync: ['数据同步', '通过 WebDAV 在多设备间同步学习数据']
    };
    const [title, sub] = titles[r.route] || ['AI 闯关学习', '本地优先的学习工具'];
    breadcrumb.innerHTML = `<span class="current">${title}</span>`;
    // Update mobile title
    const mobileTitle = document.getElementById('mobile-title');
    if (mobileTitle) mobileTitle.textContent = title;
    // Update desktop topbar title
    const dt = document.getElementById('desktop-title');
    const ds = document.getElementById('desktop-subtitle');
    if (dt) dt.textContent = title;
    if (ds) ds.textContent = sub || '';
    // Sidebar active state
    document.querySelectorAll('#sidebar .sidebar-item').forEach((item) => {
      const nav = item.dataset.nav;
      const active =
        (r.route === 'home' && nav === 'home') ||
        (r.route === 'settings' && nav === 'settings') ||
        (r.route === 'zone' && nav === 'zone') ||
        (r.route === 'cards' && nav === 'library') ||
        (r.route === 'ai' && nav === 'ai') ||
        (r.route === 'sync' && nav === 'sync');
      item.classList.toggle('active', !!active);
    });
    // Tabbar active state (mobile)
    const tabMapping = { home: 'learn', zone: 'learn', learn: 'learn', cards: 'cards', settings: 'settings', sync: 'sync' };
    const activeTab = tabMapping[r.route] || null;
    document.querySelectorAll('#tabbar .tabbar-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.nav === activeTab);
    });
    // Show/hide tabbar
    const tabbar = document.getElementById('tabbar');
    const fab = document.getElementById('fab');
    // Hide tabbar on pages with bottom buttons or full-screen content
    const hideTabbarRoutes = ['learn', 'level', 'wrong-practice', 'ai', 'upload'];
    const showTabbar = (['learn', 'cards', 'sync', 'settings'].includes(activeTab || '')) && !hideTabbarRoutes.includes(r.route);
    if (tabbar) tabbar.classList.toggle('hidden', !showTabbar);
    if (fab) fab.classList.toggle('hidden', r.route !== 'home');
    // Hide mobile back button on home page
    const mobileBack = document.getElementById('btn-mobile-back');
    if (mobileBack) mobileBack.style.visibility = r.route === 'home' ? 'hidden' : 'visible';
    // Page class for tabbar spacing
    const app = document.getElementById('app');
    if (app) app.classList.toggle('page-with-tabbar', showTabbar);
    this.updateVersionTags();
  },

  updateVersionTags() {
    const places = ['app-version', 'desktop-version', 'sidebar-version'];
    places.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '版本 ' + APP_VERSION;
    });
  },

  async init() {
    await Auth.init();
    this.bindDesktopShell();
    let target = { route: 'home', args: [] };
    const hash = location.hash.replace('#', '');
    if (hash.startsWith('zone/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'zone', args: [zoneId] };
    } else if (hash.startsWith('upload/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'upload', args: [zoneId] };
    } else if (hash.startsWith('ai/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'ai', args: [zoneId] };
    } else if (hash.startsWith('cards/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'cards', args: [zoneId] };
    } else if (hash.startsWith('learn/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'learn', args: [zoneId] };
    } else if (hash.startsWith('level/')) {
      const parts = hash.split('/');
      const zoneId = parseInt(parts[1], 10);
      const levelNo = parseInt(parts[2], 10);
      if (zoneId && levelNo) target = { route: 'level', args: [zoneId, levelNo] };
    } else if (hash.startsWith('wrong/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'wrong', args: [zoneId] };
    } else if (hash.startsWith('wrong-practice/')) {
      const zoneId = parseInt(hash.split('/')[1], 10);
      if (zoneId) target = { route: 'wrong-practice', args: [zoneId] };
    } else if (hash === 'sync') {
      target = { route: 'sync', args: [] };
    } else if (hash === 'settings') {
      target = { route: 'settings', args: [] };
    } else if (hash.startsWith('settings/')) {
      const providerId = parseInt(hash.split('/')[1], 10);
      if (providerId) target = { route: 'settings', args: [providerId] };
    }
    this.navigate(target.route, ...target.args);
    this.checkForUpdates();

    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      if (location.hash === this.lastHash) return;
      if (h === '' || h === 'home') this.navigate('home');
      else if (h === 'sync') this.navigate('sync');
      else if (h === 'settings') this.navigate('settings');
      else if (h.startsWith('settings/')) this.navigate('settings', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('zone/')) this.navigate('zone', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('upload/')) this.navigate('upload', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('ai/')) this.navigate('ai', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('cards/')) this.navigate('cards', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('level/')) {
        const parts = h.split('/');
        this.navigate('level', parseInt(parts[1], 10), parseInt(parts[2], 10));
      } else if (h.startsWith('learn/')) this.navigate('learn', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('wrong/')) this.navigate('wrong', parseInt(h.split('/')[1], 10));
      else if (h.startsWith('wrong-practice/')) this.navigate('wrong-practice', parseInt(h.split('/')[1], 10));
    });
  },

  bindDesktopShell() {
    // Sidebar navigation (new Feishu-style)
    document.querySelectorAll('#sidebar .sidebar-item').forEach((item) => {
      item.addEventListener('click', () => {
        const nav = item.dataset.nav;
        const routeMap = {
          home: 'home', zone: 'home', library: 'home',  // zone/library go to home with zone context
          ai: 'home',  // AI page needs zone context
          settings: 'settings',
          sync: 'sync'
        };
        this.navigate(routeMap[nav] || 'home');
      });
    });
    // Tabbar navigation (mobile)
    document.querySelectorAll('#tabbar .tabbar-item').forEach((item) => {
      item.addEventListener('click', () => {
        const nav = item.dataset.nav;
        const routeMap = { learn: 'home', cards: 'home', settings: 'settings', sync: 'sync' };
        this.navigate(routeMap[nav] || 'home');
      });
    });
    const backupBtn = document.getElementById('desktop-backup');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => Settings.handleExportBackup());
    }
    const settingsBtn = document.getElementById('desktop-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.navigate('settings'));
    }
    // FAB click
    const fab = document.getElementById('fab');
    if (fab) {
      fab.addEventListener('click', () => {
        if (this.currentRoute && this.currentRoute.route === 'home') {
          Zones.showCreateModal();
        }
      });
    }
    // Mobile back button
    const mobileBack = document.getElementById('btn-mobile-back');
    if (mobileBack) {
      mobileBack.addEventListener('click', () => {
        if (this.currentRoute && this.currentRoute.route !== 'home') {
          this.navigate('home');
        }
      });
    }
  },

  compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  },

  async checkForUpdates() {
    if (this._updateChecked) return;
    this._updateChecked = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.github.com/repos/K-423-YYY/AI-CardLearning/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json();
      const latest = String(data.tag_name || '').replace(/^v/i, '');
      if (!latest) return;
      if (this.compareVersions(latest, APP_VERSION.replace(/^v/i, '')) > 0) {
        this.showUpdateModal(data);
      }
    } catch (err) {
      // 离线或网络异常时静默跳过
    }
  },

  showUpdateModal(data) {
    Modal.show(`
      <h3>发现新版本</h3>
      <p style="font-size:0.9rem;color:#334155;margin-bottom:10px;">
        最新版本：<b>${Utils.esc(data.tag_name || '')}</b>
      </p>
      <p style="font-size:0.85rem;color:#64748b;margin-bottom:16px;">
        直接下载并安装新版即可，学习数据会自动保留，不要先卸载旧版。
      </p>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">稍后再说</button>
        <a class="btn btn-primary btn-sm" id="modal-download" href="${Utils.esc(data.html_url || 'https://github.com/K-423-YYY/AI-CardLearning/releases')}" target="_blank" rel="noopener">前往下载</a>
      </div>
    `);
    Modal.bindCancel();
  }
};

App.init();
