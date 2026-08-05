// AI Chat Page — dialogue-style four-stage refinement
const AIChat = {
  currentZoneId: null,
  dialog: null,
  refineState: null,
  speedRef: null,
  currentStage: 1,

  async render(zoneId) {
    this.currentZoneId = zoneId;
    this.refineState = { scope: '', outline: [], issues: [], points: [], acceptedIssues: new Set(), extensions: [], keptExtensions: new Set(), tree: null, decomposedPoints: [], mergedPoints: [], sortMode: 'easy_to_hard' };
    this.speedRef = null;

    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="btn-icon btn-back" id="btn-ai-chat-back">←</button>
          <div class="topbar-title">对话式 AI 分析</div>
          <div style="width:40px"></div>
        </header>
        <main class="main-content" id="ai-chat-area">
          <div class="settings-section">
            <h3>选择文件和模式</h3>
            <div id="ai-chat-file-list"></div>
            <div class="form-group" style="margin-top:12px">
              <label>AI 加速档位</label>
              <select id="ai-chat-speed" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px">
                <option value="auto">自动推荐</option><option value="1">普通</option><option value="5">5倍</option><option value="10">10倍</option><option value="20">20倍</option>
              </select>
            </div>
            <button class="btn btn-primary btn-block" id="btn-ai-chat-start" style="margin-top:12px">开始分析</button>
          </div>
        </main>
      </div>`;
    document.getElementById('btn-ai-chat-back').onclick = () => App.navigate('ai', zoneId);
    document.getElementById('btn-ai-chat-start').onclick = () => this.startAnalysis(zoneId);
    await this.loadFiles(zoneId);
  },

  async loadFiles(zoneId) {
    const el = document.getElementById('ai-chat-file-list');
    try {
      const data = await API.get('/api/zones/' + zoneId);
      const files = data.files || [];
      if (!files.length) { el.innerHTML = '<p class="form-hint">暂无文件</p>'; return; }
      el.innerHTML = files.map((f) => `
        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:#f8fafc;border-radius:8px;margin-bottom:4px;cursor:pointer">
          <input type="checkbox" class="ai-chat-file-check" data-id="${f.id}" checked>
          <span style="font-size:14px">${Utils.esc(f.filename)}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:auto">${Utils.formatSize(f.size)}</span>
        </label>
      `).join('');
    } catch (e) { el.innerHTML = '<p class="form-hint">加载失败</p>'; }
  },

  selectedProfile() {
    const sel = document.getElementById('ai-chat-speed');
    const m = { 1: { multiplier: 1, analyzeConcurrency: 1, generateConcurrency: 1, cardBatchSize: 1 }, 5: { multiplier: 5, analyzeConcurrency: 5, generateConcurrency: 5, cardBatchSize: 5 }, 10: { multiplier: 10, analyzeConcurrency: 10, generateConcurrency: 10, cardBatchSize: 10 }, 20: { multiplier: 20, analyzeConcurrency: 20, generateConcurrency: 20, cardBatchSize: 10 } };
    return m[sel ? Number(sel.value) || 1 : 1] || m[1];
  },

  async startAnalysis(zoneId) {
    const fileIds = Array.from(document.querySelectorAll('.ai-chat-file-check:checked')).map((cb) => parseInt(cb.dataset.id, 10));
    if (!fileIds.length) { Toast.show('请至少选择一个文件', 'error'); return; }

    const area = document.getElementById('ai-chat-area');
    const dialog = ChatDialog.create(area, {
      stage: 1, totalStages: 4, placeholder: '输入微调指令，如"请更详细分析第3章"…', showInput: true,
      actions: [
        { id: 'regenerate', label: '重新生成', cls: 'btn-outline' },
        { id: 'next-stage', label: '确认，进入下一步 →', cls: 'btn-primary' }
      ],
      onSend: (text, done) => { this.refineFeedback(1, text, done); },
      onAction: (action) => {
        if (action === 'regenerate') {
          if (this.currentStage === 1) this.runStage1(zoneId, fileIds);
          else if (this.currentStage === 2) this.runStage2(zoneId);
          else this.runStage3(zoneId);
        } else if (action === 'next-stage') {
          if (this.currentStage === 1) this.runStage2(zoneId);
          else this.runStage3(zoneId);
        } else if (action === 'skip') this.runStage3(zoneId);
        else if (action === 'generate') this.handleGenerate(zoneId);
      }
    });
    this.dialog = dialog;
    dialog.render();
    dialog.addMessage({ role: 'ai', content: '第一阶段：正在分析文件结构与知识范围…' });
    dialog.setLoading(true);

    try {
      const profile = this.selectedProfile();
      this.speedRef = { value: profile };
      const data = await API.post('/api/zones/' + zoneId + '/refine/analyze', { file_ids: fileIds, speedRef: this.speedRef, onProgress: () => {} });
      Object.assign(this.refineState, { scope: data.scope || '', outline: data.outline || [], issues: data.issues || [], points: data.knowledge_points || [], acceptedIssues: new Set((data.issues || []).map((_, i) => i)) });
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', html: `<b>第一阶段完成</b><br><br><b>范围：</b>${Utils.esc(this.refineState.scope)}<br><br><b>大纲：</b>${(this.refineState.outline || []).map((l) => '<div>· ' + Utils.esc(l) + '</div>').join('')}<br><br><b>知识点：</b>${this.refineState.points.length} 条<br><b>疑似错误：</b>${this.refineState.issues.length} 条` });
      dialog.setActions([{ id: 'regenerate', label: '重新生成', cls: 'btn-outline' }, { id: 'next-stage', label: '确认，进入延伸补充 →', cls: 'btn-primary' }]);
    } catch (e) { dialog.setLoading(false); dialog.addMessage({ role: 'ai', content: '分析失败：' + e.message }); }
  },

  async runStage1(zoneId, fileIds) { /* re-run */ this.dialog.setStage(1); return this.startAnalysis(zoneId); },

  async runStage2(zoneId) {
    this.currentStage = 2;
    const dialog = this.dialog;
    dialog.setStage(2);
    dialog.addMessage({ role: 'ai', content: '第二阶段：正在生成知识延伸与补充内容…' });
    dialog.setLoading(true);
    try {
      const data = await API.post('/api/zones/' + zoneId + '/refine/extend', { points: this.refineState.points, max_items: 8 });
      this.refineState.extensions = data.extensions || [];
      this.refineState.keptExtensions = new Set(this.refineState.extensions.map((e) => e.id));
      dialog.setLoading(false);
      const html = this.refineState.extensions.length ? this.refineState.extensions.map((item) => `<div style="margin:6px 0;padding:8px;background:#f8fafc;border-radius:6px"><b>${Utils.esc(item.category)}</b> · ${Utils.esc(item.title)}<br><span style="font-size:12px;color:#64748b">${Utils.esc(item.content || '')}</span></div>`).join('') : '没有生成延伸内容';
      dialog.addMessage({ role: 'ai', html: `<b>延伸补充完成 (${this.refineState.extensions.length} 条)</b><br><br>${html}` });
      dialog.setActions([{ id: 'regenerate', label: '重新生成', cls: 'btn-outline' }, { id: 'skip', label: '跳过延伸', cls: 'btn-outline' }, { id: 'next-stage', label: '确认，进入结构化拆解 →', cls: 'btn-primary' }]);
    } catch (e) { dialog.setLoading(false); dialog.addMessage({ role: 'ai', content: '延伸补充失败：' + e.message }); }
  },

  async runStage3(zoneId) {
    this.currentStage = 3;
    const s = this.refineState;
    const merged = [...s.points];
    (s.extensions || []).forEach((item) => { if (s.keptExtensions.has(item.id)) merged.push({ title: item.title, description: item.content, block_name: item.category }); });
    const dialog = this.dialog;
    dialog.setStage(3);
    dialog.addMessage({ role: 'ai', content: '第三阶段：正在将知识拆解为原子条目…' });
    dialog.setLoading(true);
    try {
      const data = await API.post('/api/zones/' + zoneId + '/refine/decompose', { points: merged });
      s.tree = data.tree || []; s.decomposedPoints = data.points || []; s.mergedPoints = merged;
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', html: `<b>结构化拆解完成 · ${s.decomposedPoints.length} 条原子知识点</b>` });
      dialog.setActions([{ id: 'regenerate', label: '重新拆解', cls: 'btn-outline' }, { id: 'generate', label: '确认并生成卡片', cls: 'btn-primary' }]);
    } catch (e) { dialog.setLoading(false); dialog.addMessage({ role: 'ai', content: '结构化拆解失败：' + e.message }); }
  },

  async refineFeedback(stageNum, feedback, done) {
    const dialog = this.dialog;
    dialog.addMessage({ role: 'user', content: feedback });
    dialog.setLoading(true);
    const zoneId = this.currentZoneId;
    try {
      if (stageNum === 1) {
        const fileIds = Array.from(document.querySelectorAll('.ai-chat-file-check:checked')).map((cb) => parseInt(cb.dataset.id, 10));
        const data = await API.post('/api/zones/' + zoneId + '/refine/analyze', { file_ids: fileIds, speedRef: this.speedRef, onProgress: () => {} });
        Object.assign(this.refineState, { scope: data.scope || '', outline: data.outline || [], issues: data.issues || [], points: data.knowledge_points || [] });
      } else if (stageNum === 2) {
        const data = await API.post('/api/zones/' + zoneId + '/refine/extend', { points: this.refineState.points, feedback, max_items: 8 });
        this.refineState.extensions = data.extensions || [];
      } else if (stageNum === 3) {
        const merged = [...this.refineState.points];
        (this.refineState.extensions || []).forEach((item) => { if (this.refineState.keptExtensions.has(item.id)) merged.push({ title: item.title, description: item.content, block_name: item.category }); });
        const data = await API.post('/api/zones/' + zoneId + '/refine/decompose', { points: merged, feedback });
        this.refineState.tree = data.tree || []; this.refineState.decomposedPoints = data.points || [];
      }
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: '已根据你的反馈重新生成。' });
    } catch (e) { dialog.setLoading(false); dialog.addMessage({ role: 'ai', content: '微调失败：' + e.message }); }
    done();
  },

  async handleGenerate(zoneId) {
    this.currentStage = 4;
    const dialog = this.dialog;
    dialog.setStage(4);
    dialog.addMessage({ role: 'ai', content: '第四阶段：正在生成知识卡片…' });
    dialog.setLoading(true);
    const s = this.refineState;
    let points = s.decomposedPoints.length ? s.decomposedPoints : s.points;
    const order = { '易': 0, '中': 1, '难': 2 };
    points.sort((a, b) => (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1) || String(a.path || '').localeCompare(String(b.path || '')));
    try {
      const groups = {}; points.forEach((p) => { const b = p.block_name || '全部知识点'; (groups[b] = groups[b] || []).push(p); });
      const blocks = Object.entries(groups).map(([name, pts]) => ({ name, points: pts }));
      const data = await API.post('/api/zones/' + zoneId + '/generate', { blocks, replace_old: 'none', speedRef: { value: this.selectedProfile() }, onProgress: () => {} });
      dialog.setLoading(false);
      const failed = (data.failed || []).length;
      const skipped = data.skipped || 0;
      let msg = `卡片生成完成：${data.generated} 张`;
      if (skipped) msg += `，${skipped} 张跳过`;
      if (failed) msg += `，${failed} 个失败`;
      dialog.addMessage({ role: 'ai', content: msg });
      Toast.show('生成 ' + data.generated + ' 张卡片', 'success');
      setTimeout(() => App.navigate('zone', zoneId), 2000);
    } catch (e) { dialog.setLoading(false); dialog.addMessage({ role: 'ai', content: '生成失败：' + e.message }); }
  }
};
