// Utility helpers
const Utils = {
  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.replace(' ', 'T') + '+08:00');
    if (isNaN(d)) return dateStr.slice(0, 10);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    const days = Math.floor(diff / 86400);
    if (days < 30) return days + '天前';
    return dateStr.slice(0, 10);
  },

  formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};

// Toast notification
const Toast = {
  show(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast-global show ' + (type || '');
    clearTimeout(el._tid);
    el._tid = setTimeout(() => el.classList.remove('show'), 3000);
  }
};

// Main App controller - SPA router
const App = {
  currentRoute: null,
  lastHash: null,

  // Navigate to a route
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
      case 'login':   this._renderLogin(); break;
      case 'home':    Zones.renderHome(); break;
      case 'zone':    Zones.renderZone(r.args[0]); break;
      case 'upload':  Zones.renderUpload(r.args[0]); break;
      case 'ai':      Zones.renderAi(r.args[0]); break;
      case 'cards':   Zones.renderCards(r.args[0]); break;
      case 'level':   Cards.renderLevel(r.args[0], r.args[1]); break;
      case 'learn':   Cards.renderLearn(r.args[0]); break;
      case 'wrong':   Cards.renderWrong(r.args[0]); break;
      case 'wrong-practice': Cards.renderWrongPractice(r.args[0]); break;
      case 'settings': r.args.length ? Settings.renderDetail(r.args[0]) : Settings.render(); break;
    }
  },

  // Set inner HTML from a template clone
  setPage(tpl) {
    const app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));
  },

  async _renderLogin() {
    const tpl = document.getElementById('tpl-login');
    this.setPage(tpl);

    const panels = [
      document.getElementById('login-pwd-form'),
      document.getElementById('login-code-form'),
      document.getElementById('register-form'),
      document.getElementById('reset-form')
    ];
    const tabPwd = document.getElementById('tab-pwd');
    const tabCode = document.getElementById('tab-code');
    const showPanel = (panel) => {
      panels.forEach(p => p.classList.toggle('hidden', p !== panel));
    };

    tabPwd.addEventListener('click', () => {
      tabPwd.classList.add('active');
      tabCode.classList.remove('active');
      showPanel(panels[0]);
    });
    tabCode.addEventListener('click', () => {
      tabCode.classList.add('active');
      tabPwd.classList.remove('active');
      showPanel(panels[1]);
    });

    document.getElementById('link-register').addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(panels[2]);
    });
    document.getElementById('link-reset').addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(panels[3]);
    });
    document.getElementById('link-back-login-reg').addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(panels[0]);
    });
    document.getElementById('link-back-login-reset').addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(panels[0]);
    });
    document.getElementById('link-back-login-code').addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(panels[0]);
    });

    const bindSend = (btn, emailEl, codeEl, hintId, purpose) => {
      const hint = document.getElementById(hintId);
      const refresh = () => {
        btn.disabled = !Auth.isValidEmail(emailEl.value) || Auth.countdown > 0;
      };
      emailEl.addEventListener('input', refresh);
      btn.addEventListener('click', async () => {
        const email = emailEl.value.trim();
        if (!Auth.isValidEmail(email)) {
          Toast.show('请输入正确的邮箱', 'error');
          return;
        }
        btn.disabled = true;
        try {
          const data = await Auth.sendCode(email, purpose);
          Toast.show('验证码已发送');
          if (data && data.dev_code) {
            hint.classList.remove('hidden');
            hint.innerHTML = '💡 开发模式验证码：<b>' + data.dev_code + '</b>（点击自动填入）';
            hint.onclick = () => { codeEl.value = data.dev_code; };
          }
          Auth.startCountdown(btn);
          codeEl.focus();
        } catch (e) {
          Toast.show(e.message, 'error');
          btn.disabled = false;
        }
      });
    };

    const emailEl = document.getElementById('login-email');
    const pwdEl = document.getElementById('login-password');
    const codeEmailEl = document.getElementById('login-code-email');
    const codeEl = document.getElementById('login-code-value');
    const regEmailEl = document.getElementById('reg-email');
    const regCodeEl = document.getElementById('reg-code');
    const regPwdEl = document.getElementById('reg-password');
    const resetEmailEl = document.getElementById('reset-email');
    const resetCodeEl = document.getElementById('reset-code');
    const resetPwdEl = document.getElementById('reset-password');

    bindSend(document.getElementById('btn-send-login-code'), codeEmailEl, codeEl, 'dev-code-hint-login', 'login');
    bindSend(document.getElementById('btn-send-reg-code'), regEmailEl, regCodeEl, 'dev-code-hint-reg', 'register');
    bindSend(document.getElementById('btn-send-reset-code'), resetEmailEl, resetCodeEl, 'dev-code-hint-reset', 'reset');

    document.getElementById('login-pwd-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isValidEmail(emailEl.value)) {
        Toast.show('请输入正确的邮箱', 'error');
        return;
      }
      if (!Auth.isValidPassword(pwdEl.value)) {
        Toast.show('密码至少6位', 'error');
        return;
      }
      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        await Auth.login(emailEl.value.trim(), pwdEl.value);
        Toast.show('登录成功', 'success');
        this.navigate('home');
      } catch (err) {
        Toast.show(err.message, 'error');
        btn.disabled = false;
        btn.textContent = '登录';
      }
    });

    document.getElementById('login-code-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isValidEmail(codeEmailEl.value)) {
        Toast.show('请输入正确的邮箱', 'error');
        return;
      }
      if (codeEl.value.trim().length !== 6) {
        Toast.show('请输入6位验证码', 'error');
        return;
      }
      const btn = document.getElementById('btn-login-code');
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        await Auth.loginWithCode(codeEmailEl.value.trim(), codeEl.value.trim());
        Toast.show('登录成功', 'success');
        this.navigate('home');
      } catch (err) {
        Toast.show(err.message, 'error');
        btn.disabled = false;
        btn.textContent = '登录 / 注册';
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isValidEmail(regEmailEl.value)) {
        Toast.show('请输入正确的邮箱', 'error');
        return;
      }
      if (regCodeEl.value.trim().length !== 6) {
        Toast.show('请输入6位验证码', 'error');
        return;
      }
      if (!Auth.isValidPassword(regPwdEl.value)) {
        Toast.show('密码至少6位', 'error');
        return;
      }
      const btn = document.getElementById('btn-register');
      btn.disabled = true;
      btn.textContent = '注册中…';
      try {
        await Auth.register(regEmailEl.value.trim(), regCodeEl.value.trim(), regPwdEl.value);
        Toast.show('注册成功，请登录', 'success');
        emailEl.value = regEmailEl.value.trim();
        showPanel(panels[0]);
      } catch (err) {
        Toast.show(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '注册';
      }
    });

    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isValidEmail(resetEmailEl.value)) {
        Toast.show('请输入正确的邮箱', 'error');
        return;
      }
      if (resetCodeEl.value.trim().length !== 6) {
        Toast.show('请输入6位验证码', 'error');
        return;
      }
      if (!Auth.isValidPassword(resetPwdEl.value)) {
        Toast.show('密码至少6位', 'error');
        return;
      }
      const btn = document.getElementById('btn-reset');
      btn.disabled = true;
      btn.textContent = '重置中…';
      try {
        await Auth.resetPassword(resetEmailEl.value.trim(), resetCodeEl.value.trim(), resetPwdEl.value);
        Toast.show('密码已重置，请登录', 'success');
        emailEl.value = resetEmailEl.value.trim();
        showPanel(panels[0]);
      } catch (err) {
        Toast.show(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '重置密码';
      }
    });
  },

  // Bootstrap: check auth, then route
  async init() {
    const loggedIn = await Auth.init();
    const hash = location.hash.replace('#', '');
    if (loggedIn) {
      if (hash.startsWith('zone/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('zone', zoneId); return; }
      }
      if (hash.startsWith('upload/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('upload', zoneId); return; }
      }
      if (hash.startsWith('ai/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('ai', zoneId); return; }
      }
      if (hash.startsWith('cards/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('cards', zoneId); return; }
      }
      if (hash.startsWith('learn/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('learn', zoneId); return; }
      }
      if (hash.startsWith('level/')) {
        const parts = hash.split('/');
        const zoneId = parseInt(parts[1]);
        const levelNo = parseInt(parts[2]);
        if (zoneId && levelNo) { this.navigate('level', zoneId, levelNo); return; }
      }
      if (hash.startsWith('wrong/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('wrong', zoneId); return; }
      }
      if (hash.startsWith('wrong-practice/')) {
        const zoneId = parseInt(hash.split('/')[1]);
        if (zoneId) { this.navigate('wrong-practice', zoneId); return; }
      }
      if (hash === 'settings') { this.navigate('settings'); return; }
      if (hash.startsWith('settings/')) {
        const providerId = parseInt(hash.split('/')[1]);
        if (providerId) { this.navigate('settings', providerId); return; }
      }
      this.navigate('home');
    } else {
      this.navigate('login');
    }

    // Hash change listener for back/forward
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      if (location.hash === App.lastHash) return;
      if (h === '' || h === 'home') App.navigate('home');
      else if (h === 'settings') App.navigate('settings');
      else if (h.startsWith('settings/')) App.navigate('settings', parseInt(h.split('/')[1]));
      else if (h.startsWith('zone/')) App.navigate('zone', parseInt(h.split('/')[1]));
      else if (h.startsWith('upload/')) App.navigate('upload', parseInt(h.split('/')[1]));
      else if (h.startsWith('ai/')) App.navigate('ai', parseInt(h.split('/')[1]));
      else if (h.startsWith('cards/')) App.navigate('cards', parseInt(h.split('/')[1]));
      else if (h.startsWith('level/')) {
        const parts = h.split('/');
        App.navigate('level', parseInt(parts[1]), parseInt(parts[2]));
      }
      else if (h.startsWith('learn/')) App.navigate('learn', parseInt(h.split('/')[1]));
      else if (h.startsWith('wrong/')) App.navigate('wrong', parseInt(h.split('/')[1]));
      else if (h.startsWith('wrong-practice/')) App.navigate('wrong-practice', parseInt(h.split('/')[1]));
    });
  }
};

// Start the app
App.init();
