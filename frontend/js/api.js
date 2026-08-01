// API client - communicates with backend FastAPI
const API = {
  async request(method, url, body = null) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    // 401 => redirect to login
    if (res.status === 401) {
      App.navigate('login');
      throw new Error('未登录');
    }
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(data.message || '请求失败');
    }
    return data.data;
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  delete(url) { return this.request('DELETE', url); },

  async upload(url, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(url, { method: 'POST', body: form });
    if (res.status === 401) { App.navigate('login'); throw new Error('未登录'); }
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.message || '上传失败');
    return data.data;
  }
};
