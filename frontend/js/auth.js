// Auth module - login / logout / current user
const Auth = {
  user: null,
  countdown: 0,
  timer: null,

  // Check if already logged in
  async init() {
    try {
      const data = await API.get('/api/me');
      this.user = data.user;
      return true;
    } catch {
      return false;
    }
  },

  // Send email verification code
  async sendCode(email, purpose = 'login') {
    return API.post('/api/auth/send-code', { email, purpose });
  },

  // Login with email + password
  async login(email, password) {
    const data = await API.post('/api/auth/login', { email, password });
    this.user = data.user;
    return data;
  },

  // Login / register with email verification code
  async loginWithCode(email, code) {
    const data = await API.post('/api/auth/login-code', { email, code });
    this.user = data.user;
    return data;
  },

  // Register with email code + password
  async register(email, code, password) {
    return API.post('/api/auth/register', { email, code, password });
  },

  // Reset password with email code
  async resetPassword(email, code, password) {
    return API.post('/api/auth/reset-password', { email, code, password });
  },

  // Logout
  async logout() {
    await API.post('/api/auth/logout');
    this.user = null;
  },

  // Start code resend countdown (60s)
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

  // Validate email format
  isValidEmail(email) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  },

  // Validate password length
  isValidPassword(password) {
    return password.length >= 6;
  }
};
