// Local version: no account, no login. The app opens straight into the home page.
const Auth = {
  user: null,
  countdown: 0,
  timer: null,

  async init() {
    try {
      const data = await API.get('/api/me');
      this.user = data.user;
    } catch (err) {
      this.user = { id: 1, email: 'local@user', nickname: '' };
    }
    return true;
  },

  async logout() {
    this.user = null;
    return { ok: true };
  },

  async sendCode() {
    return { dev_code: '000000' };
  },

  async login() {
    return { user: this.user };
  },

  async loginWithCode() {
    return { user: this.user };
  },

  async register() {
    return { ok: true };
  },

  async resetPassword() {
    return { ok: true };
  },

  startCountdown(btn) {
    this.countdown = 60;
    btn.disabled = true;
    const tick = () => {
      if (this.countdown <= 0) {
        btn.disabled = false;
        btn.textContent = '发送验证码';
        this.timer = null;
        return;
      }
      btn.textContent = `${this.countdown}秒后重发`;
      this.countdown--;
      this.timer = setTimeout(tick, 1000);
    };
    tick();
  },

  isValidEmail(email) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
  },

  isValidPassword(password) {
    return String(password || '').length >= 6;
  }
};
