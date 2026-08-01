const APP_VERSION = '0.1.2';

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

const Toast = {
  show(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast-global show ' + (type || '');
    clearTimeout(el._tid);
    el._tid = setTimeout(() => el.classList.remove('show'), 3000);
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
      case 'settings':
        r.args.length ? Settings.renderDetail(r.args[0]) : Settings.render();
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
    const titleEl = document.getElementById('desktop-title');
    const subEl = document.getElementById('desktop-subtitle');
    if (!titleEl) return;
    const titles = {
      home: ['学习总览', '管理学习区，规划每日闯关'],
      zone: ['学习区详情', '上传资料、生成卡片、查看闯关路径'],
      upload: ['上传文件', '支持 txt / md / cpp / h / py / pdf'],
      ai: ['AI 趋势分析', '自动提取知识点并生成知识卡片'],
      cards: ['知识卡片', '浏览、复习或删除全部卡片'],
      level: ['关卡学习', '完成本关任务'],
      learn: ['今日闯关', '新学卡片 + 到期复习'],
      wrong: ['错题集', '集中重练答错的卡片'],
      'wrong-practice': ['错题练习', '独立复习模式'],
      settings: ['设置', '个人偏好、AI 服务商与本地备份']
    };
    const [title, sub] = titles[r.route] || ['AI 闯关学习', '本地优先的学习工具'];
    titleEl.textContent = title;
    subEl.textContent = sub;
    document.querySelectorAll('.sidebar-item').forEach((item) => {
      const active = (r.route === 'home' && item.dataset.nav === 'home') ||
        (r.route === 'settings' && item.dataset.nav === 'settings');
      item.classList.toggle('active', !!active);
    });
    this.updateVersionTags();
  },

  updateVersionTags() {
    const mobile = document.getElementById('app-version');
    const desktop = document.getElementById('desktop-version');
    if (mobile) mobile.textContent = '版本 ' + APP_VERSION;
    if (desktop) desktop.textContent = '版本 ' + APP_VERSION;
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
    } else if (hash === 'settings') {
      target = { route: 'settings', args: [] };
    } else if (hash.startsWith('settings/')) {
      const providerId = parseInt(hash.split('/')[1], 10);
      if (providerId) target = { route: 'settings', args: [providerId] };
    }
    this.navigate(target.route, ...target.args);

    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      if (location.hash === this.lastHash) return;
      if (h === '' || h === 'home') this.navigate('home');
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
    document.querySelectorAll('.sidebar-item').forEach((item) => {
      item.addEventListener('click', () => {
        const nav = item.dataset.nav;
        if (nav === 'home') this.navigate('home');
        if (nav === 'settings') this.navigate('settings');
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
  }
};

App.init();
