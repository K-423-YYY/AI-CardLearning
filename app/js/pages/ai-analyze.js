// AI Analyze Page — four-stage refinement with independent chat dialogs and micro-adjustment
// Replaces the old monolithic tpl-ai template + Zones.renderAi/handleRefineStage*
const AIAnalyze = {
  currentZoneId: null,
  refineState: null,
  chatDialog: null,
  speedRef: null,

  // Stage definitions
  STAGES: {
    1: { name: '结构范围分析', key: 'refineStage1', systemPrompt: null },
    2: { name: '知识延伸补充', key: 'refineStage2', systemPrompt: null },
    3: { name: '结构化拆解', key: 'refineStage3', systemPrompt: null },
    4: { name: '生成卡片', key: 'refineGenerate', systemPrompt: null }
  },

  // ── Entry: render full AI analysis page ──
  async render(zoneId) {
    this.currentZoneId = zoneId;
    this.refineState = {
      scope: '', outline: [], issues: [], points: [],
      acceptedIssues: new Set(),
      extensions: [], keptExtensions: new Set(),
      tree: null, decomposedPoints: [], mergedPoints: [],
      sortMode: 'easy_to_hard'
    };
    this.speedRef = null;

    const tpl = document.getElementById('tpl-ai-chat-new');
    if (tpl) {
      App.setPage(tpl);
    } else {
      // Fallback: build page dynamically
      const app = document.getElementById('app');
      app.innerHTML = `
        <div class="page page-wide" id="ai-analyze-page">
          <div class="ai-mode-bar">
            <div class="segmented">
              <button class="segmented-btn active" data-mode="quick">快速生成</button>
              <button class="segmented-btn" data-mode="refine">四阶段精炼</button>
            </div>
          </div>
          <div class="ai-setup-card card" id="ai-setup">
            <div class="card-header">
              <span class="card-title">选择分析文件</span>
            </div>
            <div id="ai-file-list" class="ai-select-list"></div>
            <div style="margin-top:12px">
              <label style="font-size:13px;color:var(--color-text-secondary)">AI 加速档位</label>
              <select id="ai-speed-select" style="width:100%;margin-top:4px">
                <option value="auto">自动推荐</option>
                <option value="1">普通</option>
                <option value="5">5倍</option>
                <option value="10">10倍</option>
                <option value="20">20倍</option>
              </select>
              <div id="ai-speed-hint" style="font-size:11px;color:var(--color-text-tertiary);margin-top:4px"></div>
            </div>
            <button class="btn btn-primary btn-block" id="btn-ai-start" style="margin-top:16px">开始分析</button>
          </div>
          <div id="ai-chat-area"></div>
          <div id="ai-result-preview" class="hidden"></div>
        </div>
      `;
    }

    await this.loadFiles(zoneId);
    await this.renderSpeed(zoneId);
    this.bindModeSelector(zoneId);
  },

  // ── File selector ──
  async loadFiles(zoneId) {
    const listEl = document.getElementById('ai-file-list');
    if (!listEl) return;
    try {
      const data = await API.get(`/api/zones/${zoneId}`);
      const files = data.files || [];
      if (!files.length) {
        listEl.innerHTML = '<div class="empty-state"><p>暂无文件，请先上传</p></div>';
        return;
      }
      listEl.innerHTML = files.map((f) => `
        <label class="library-item" style="cursor:pointer">
          <input type="checkbox" class="ai-file-check" data-id="${f.id}" checked>
          <div class="library-item-body">
            <div class="library-item-title">${Utils.esc(f.filename)}</div>
            <div class="library-item-meta">${Utils.formatSize(f.size)}</div>
          </div>
        </label>
      `).join('');
    } catch (e) {
      if (listEl) listEl.innerHTML = `<div class="empty-state"><p>${Utils.esc(e.message)}</p></div>`;
    }
  },

  async renderSpeed(zoneId) {
    const select = document.getElementById('ai-speed-select');
    const hint = document.getElementById('ai-speed-hint');
    if (!select || !hint) return;
    try {
      const zone = await API.get(`/api/zones/${zoneId}`);
      const files = zone.files || [];
      const totalBytes = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
      const label = totalBytes < 1024 ? `${totalBytes}B` : totalBytes < 1048576 ? `${Math.round(totalBytes / 1024)}KB` : `${(totalBytes / 1048576).toFixed(1)}MB`;
      // Determine recommended tier
      let rec = 1;
      if (totalBytes >= 20 * 1048576) rec = 20;
      else if (totalBytes >= 5 * 1048576) rec = 10;
      else if (totalBytes >= 1 * 1048576) rec = 5;
      select.value = 'auto';
      hint.textContent = `推荐：${rec === 1 ? '普通' : rec + '倍'}（文件约 ${label}）。可手动切换。`;
    } catch (e) {
      hint.textContent = '';
    }
  },

  bindModeSelector(zoneId) {
    document.querySelectorAll('#ai-analyze-page .segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ai-analyze-page .segmented-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.isRefine = btn.dataset.mode === 'refine';
      });
    });
    const startBtn = document.getElementById('btn-ai-start');
    if (startBtn) {
      startBtn.onclick = () => this.handleStart(zoneId);
    }
  },

  // ── Start analysis ──
  async handleStart(zoneId) {
    const fileIds = Array.from(document.querySelectorAll('.ai-file-check:checked')).map((cb) => parseInt(cb.dataset.id, 10));
    if (!fileIds.length) { Toast.show('请至少选择一个文件', 'error'); return; }

    const setupEl = document.getElementById('ai-setup');
    if (setupEl) setupEl.classList.add('hidden');

    const isRefine = document.querySelector('#ai-analyze-page .segmented-btn:last-child')?.classList.contains('active');

    if (isRefine) {
      await this.runRefineStage1(zoneId, fileIds);
    } else {
      await this.runQuickAnalyze(zoneId, fileIds);
    }
  },

  // ── Quick Mode ──
  async runQuickAnalyze(zoneId, fileIds) {
    const area = document.getElementById('ai-chat-area');
    area.innerHTML = '';

    const dialog = ChatDialog.create(area, {
      stage: 1, totalStages: 1,
      placeholder: '',
      showInput: false,
      actions: [
        { id: 'regenerate', label: '重新分析', cls: 'btn-outline' },
        { id: 'generate-cards', label: '确认并生成卡片', cls: 'btn-primary' }
      ],
      onAction: (action) => {
        if (action === 'regenerate') this.runQuickAnalyze(zoneId, fileIds);
        else if (action === 'generate-cards') this.handleGenerate(zoneId);
      }
    });
    this.chatDialog = dialog;
    dialog.render();
    dialog.addMessage({ role: 'ai', content: '正在分析选中的文件，提取知识点…' });
    dialog.setLoading(true);

    try {
      const profile = this.selectedProfile();
      this.speedRef = { value: profile };
      const data = await API.post(`/api/zones/${zoneId}/analyze`, {
        file_ids: fileIds,
        speedRef: this.speedRef,
        onProgress: (done, total) => {}
      });
      this.refineState.points = data.knowledge_points || [];
      await API.post(`/api/zones/${zoneId}/ai-history`, {
        type: 'analyze',
        payload: { knowledge_points: this.refineState.points, summary: `${this.refineState.points.length} 条知识点` }
      });

      dialog.setLoading(false);
      const groups = {};
      this.refineState.points.forEach((p) => {
        const b = p.block_name || '全部知识点';
        (groups[b] = groups[b] || []).push(p);
      });
      let resultHtml = '<div style="max-height:300px;overflow-y:auto">';
      for (const [block, pts] of Object.entries(groups)) {
        resultHtml += `<div style="margin-bottom:8px"><strong>${Utils.esc(block)}</strong> · ${pts.length} 个知识点</div>`;
        pts.forEach((p) => {
          resultHtml += `<div style="font-size:13px;padding:4px 0;border-top:1px solid var(--color-border-light)">${Utils.esc(p.title)}</div>`;
        });
      }
      resultHtml += '</div>';
      dialog.addMessage({ role: 'ai', html: `分析完成，共 <b>${this.refineState.points.length}</b> 条知识点：${resultHtml}` });
    } catch (e) {
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `分析失败：${e.message}` });
    }
  },

  // ── Four-Stage Refine: Stage 1 ──
  async runRefineStage1(zoneId, fileIds) {
    const area = document.getElementById('ai-chat-area');
    area.innerHTML = '';

    const dialog = ChatDialog.create(area, {
      stage: 1, totalStages: 4,
      placeholder: '输入微调指令，如"请更详细分析第3章"…',
      showInput: true,
      actions: [
        { id: 'regenerate', label: '重新生成', cls: 'btn-outline' },
        { id: 'confirm-stage2', label: '确认，进入延伸补充 →', cls: 'btn-primary' }
      ],
      onSend: (text, done) => {
        this.microAdjustStage(1, text, done);
      },
      onAction: (action) => {
        if (action === 'regenerate') this.runRefineStage1(zoneId, fileIds);
        else if (action === 'confirm-stage2') this.runRefineStage2(zoneId);
      }
    });
    this.chatDialog = dialog;
    dialog.render();
    dialog.addMessage({ role: 'ai', content: '第一阶段：正在分析文件结构与知识范围…' });
    dialog.setLoading(true);

    try {
      const profile = this.selectedProfile();
      this.speedRef = { value: profile };
      const data = await API.post(`/api/zones/${zoneId}/refine/analyze`, {
        file_ids: fileIds,
        speedRef: this.speedRef,
        onProgress: (done, total) => {}
      });
      Object.assign(this.refineState, {
        scope: data.scope || '',
        outline: data.outline || [],
        issues: data.issues || [],
        points: data.knowledge_points || [],
        acceptedIssues: new Set((data.issues || []).map((_, i) => i))
      });
      dialog.setLoading(false);

      const issuesHtml = this.refineState.issues.length
        ? this.refineState.issues.map((item, i) => `
            <div style="margin:6px 0;padding:6px;background:#fff;border-radius:4px;font-size:12px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" class="issue-check" data-idx="${i}" checked> ${Utils.esc(item.issue)}
              </label>
              ${item.source ? `<div style="color:#8F959E;margin-top:2px">原文：${Utils.esc(item.source)}</div>` : ''}
              ${item.suggestion ? `<div style="color:#3370FF;margin-top:2px">建议：${Utils.esc(item.suggestion)}</div>` : ''}
            </div>
          `).join('')
        : '<div style="color:#8F959E">未发现疑似错误</div>';

      dialog.addMessage({
        role: 'ai',
        html: `<div><b>范围：</b>${Utils.esc(this.refineState.scope || '')}</div>
              <div style="margin-top:8px"><b>大纲：</b>${(this.refineState.outline || []).map((l) => `<div>${Utils.esc(l)}</div>`).join('')}</div>
              <div style="margin-top:8px"><b>疑似错误（${this.refineState.issues.length}）：</b>${issuesHtml}</div>`
      });

      // Bind issue checkboxes
      setTimeout(() => {
        document.querySelectorAll('.issue-check').forEach((cb) => {
          cb.onchange = () => {
            const idx = Number(cb.dataset.idx);
            if (cb.checked) this.refineState.acceptedIssues.add(idx);
            else this.refineState.acceptedIssues.delete(idx);
          };
        });
      }, 50);

    } catch (e) {
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `分析失败：${e.message}` });
    }
  },

  // ── Stage 2: Extension ──
  async runRefineStage2(zoneId) {
    const dialog = this.chatDialog;
    dialog.setStage(2);
    dialog.setActions([
      { id: 'regenerate', label: '重新生成', cls: 'btn-outline' },
      { id: 'skip-ext', label: '跳过延伸', cls: 'btn-ghost' },
      { id: 'confirm-stage3', label: '确认，进入结构化拆解 →', cls: 'btn-primary' }
    ]);
    dialog.addMessage({ role: 'ai', content: '第二阶段：正在生成知识延伸与补充内容…' });
    dialog.setLoading(true);

    try {
      const data = await API.post(`/api/zones/${zoneId}/refine/extend`, {
        points: this.refineState.points,
        max_items: 8
      });
      this.refineState.extensions = data.extensions || [];
      this.refineState.keptExtensions = new Set(this.refineState.extensions.map((e) => e.id));

      dialog.setLoading(false);
      const extHtml = this.refineState.extensions.length
        ? this.refineState.extensions.map((item) => `
            <div style="margin:6px 0;padding:8px;background:#fff;border:1px solid var(--color-border);border-radius:6px;font-size:13px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
                <input type="checkbox" class="ext-check" data-id="${Utils.esc(item.id)}" checked>
                <span style="color:#3370FF">${Utils.esc(item.category)}</span>
                ${Utils.esc(item.title)}
              </label>
              <div style="margin-top:4px;color:#646A73">${Utils.esc(item.content || '')}</div>
              <div style="font-size:11px;color:#8F959E;margin-top:4px">理由：${Utils.esc(item.reason || '')}</div>
            </div>
          `).join('')
        : '<div style="color:#8F959E">没有生成延伸内容</div>';

      dialog.addMessage({ role: 'ai', html: `<b>延伸补充（${this.refineState.extensions.length} 条）</b>${extHtml}` });

      setTimeout(() => {
        document.querySelectorAll('.ext-check').forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) this.refineState.keptExtensions.add(cb.dataset.id);
            else this.refineState.keptExtensions.delete(cb.dataset.id);
          };
        });
      }, 50);

    } catch (e) {
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `延伸补充失败：${e.message}` });
    }
  },

  // ── Stage 3: Decomposition ──
  async runRefineStage3(zoneId) {
    const dialog = this.chatDialog;
    const s = this.refineState;
    const merged = [...s.points];
    (s.extensions || []).forEach((item) => {
      if (!s.keptExtensions.has(item.id)) return;
      merged.push({ title: item.title, description: item.content, block_name: item.category });
    });

    dialog.setStage(3);
    dialog.setActions([
      { id: 'regenerate', label: '重新拆解', cls: 'btn-outline' },
      { id: 'sort-easy', label: '由易到难', cls: 'btn-ghost' },
      { id: 'sort-block', label: '按结构', cls: 'btn-ghost' },
      { id: 'generate-cards', label: '确认并生成卡片', cls: 'btn-primary' }
    ]);
    dialog.addMessage({ role: 'ai', content: '第三阶段：正在将知识拆解为原子条目并构建知识树…' });
    dialog.setLoading(true);

    try {
      const data = await API.post(`/api/zones/${zoneId}/refine/decompose`, { points: merged });
      s.tree = data.tree || [];
      s.decomposedPoints = data.points || [];
      s.mergedPoints = merged;

      dialog.setLoading(false);
      const treeHtml = this.renderTreeHtml(s.tree);
      dialog.addMessage({ role: 'ai', html: `<b>结构化拆解完成 · ${s.decomposedPoints.length} 条原子知识点</b><div style="margin-top:8px">${treeHtml}</div>` });
    } catch (e) {
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `结构化拆解失败：${e.message}` });
    }
  },

  // ── Micro-adjustment handler ──
  async microAdjustStage(stageNum, userFeedback, done) {
    const dialog = this.chatDialog;
    dialog.addMessage({ role: 'user', content: userFeedback });
    dialog.setLoading(true);

    try {
      // Re-run the corresponding stage with user feedback appended to the AI prompt context
      let result;
      const zoneId = this.currentZoneId;
      if (stageNum === 1) {
        // Re-run stage 1 with feedback
        const fileIds = Array.from(document.querySelectorAll('.ai-file-check:checked')).map((cb) => parseInt(cb.dataset.id, 10));
        result = await API.post(`/api/zones/${zoneId}/refine/analyze`, {
          file_ids: fileIds,
          feedback: userFeedback,
          speedRef: this.speedRef,
          onProgress: () => {}
        });
        Object.assign(this.refineState, {
          scope: result.scope || '', outline: result.outline || [],
          issues: result.issues || [], points: result.knowledge_points || [],
          acceptedIssues: new Set((result.issues || []).map((_, i) => i))
        });
      } else if (stageNum === 2) {
        result = await API.post(`/api/zones/${zoneId}/refine/extend`, {
          points: this.refineState.points,
          feedback: userFeedback,
          max_items: 8
        });
        this.refineState.extensions = result.extensions || [];
        this.refineState.keptExtensions = new Set(this.refineState.extensions.map((e) => e.id));
      } else if (stageNum === 3) {
        const merged = [...this.refineState.points];
        (this.refineState.extensions || []).forEach((item) => {
          if (!this.refineState.keptExtensions.has(item.id)) return;
          merged.push({ title: item.title, description: item.content, block_name: item.category });
        });
        result = await API.post(`/api/zones/${zoneId}/refine/decompose`, {
          points: merged, feedback: userFeedback
        });
        this.refineState.tree = result.tree || [];
        this.refineState.decomposedPoints = result.points || [];
      }

      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `已根据你的反馈重新生成第${stageNum}阶段结果。` });
    } catch (e) {
      dialog.setLoading(false);
      dialog.addMessage({ role: 'ai', content: `微调失败：${e.message}` });
    }
    done();
  },

  // ── Card Generation (Stage 4) ──
  async handleGenerate(zoneId) {
    const dialog = this.chatDialog;
    if (dialog) dialog.setStage(4);
    if (dialog) dialog.addMessage({ role: 'ai', content: '第四阶段：正在生成知识卡片…' });
    if (dialog) dialog.setLoading(true);

    const s = this.refineState;
    let points = s.decomposedPoints.length ? s.decomposedPoints : s.points;

    // Apply sort
    const order = { '易': 0, '中': 1, '难': 2 };
    if (s.sortMode === 'block') {
      points.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')) || (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1));
    } else {
      points.sort((a, b) => (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1) || String(a.path || '').localeCompare(String(b.path || '')));
    }

    try {
      const groups = {};
      points.forEach((p) => { const b = p.block_name || '全部知识点'; (groups[b] = groups[b] || []).push(p); });
      const blocks = Object.entries(groups).map(([name, pts]) => ({ name, points: pts }));

      const profile = this.selectedProfile();
      const data = await API.post(`/api/zones/${zoneId}/generate`, {
        blocks, replace_old: 'none',
        speedRef: { value: profile },
        onProgress: (done, total) => {}
      });

      if (dialog) dialog.setLoading(false);
      const failedCount = (data.failed || []).length;
      const skippedCount = data.skipped || 0;
      let msg = `✅ 卡片生成完成：${data.generated} 张`;
      if (skippedCount) msg += `，${skippedCount} 张跳过`;
      if (failedCount) msg += `，${failedCount} 个失败`;
      if (dialog) dialog.addMessage({ role: 'ai', content: msg });

      await API.post(`/api/zones/${zoneId}/ai-history`, {
        type: 'refine',
        payload: { knowledge_points: points, summary: `${data.generated} 张卡片` }
      });

      Toast.show(`成功生成 ${data.generated} 张卡片`, 'success');
      setTimeout(() => App.navigate('zone', zoneId), 1500);
    } catch (e) {
      if (dialog) dialog.setLoading(false);
      if (dialog) dialog.addMessage({ role: 'ai', content: `生成失败：${e.message}` });
    }
  },

  // ── Helpers ──
  selectedProfile() {
    const select = document.getElementById('ai-speed-select');
    const profiles = {
      1: { multiplier: 1, analyzeConcurrency: 1, generateConcurrency: 1, cardBatchSize: 1 },
      5: { multiplier: 5, analyzeConcurrency: 5, generateConcurrency: 5, cardBatchSize: 5 },
      10: { multiplier: 10, analyzeConcurrency: 10, generateConcurrency: 10, cardBatchSize: 10 },
      20: { multiplier: 20, analyzeConcurrency: 20, generateConcurrency: 20, cardBatchSize: 10 }
    };
    return profiles[Number(select?.value) || 1] || profiles[1];
  },

  renderTreeHtml(tree) {
    if (!Array.isArray(tree) || !tree.length) return '<div style="color:#8F959E">知识树为空</div>';
    const buildNode = (node) => {
      const name = Utils.esc((node && node.name) || '未命名');
      const structures = (node && node.structures) || [];
      const blocks = (node && node.blocks) || [];
      let children = '';
      if (structures.length) {
        children = '<ul style="padding-left:16px">' + structures.map(buildNode).join('') + '</ul>';
      } else if (blocks.length) {
        children = '<ul style="padding-left:16px">' + blocks.map((b) => {
          const pts = (b.points || []).map((p) => `<li style="font-size:12px;color:#646A73">${Utils.esc(p.title)}</li>`).join('');
          return `<li><strong>${Utils.esc(b.name || '未分区')}</strong>${pts ? pts : ''}</li>`;
        }).join('') + '</ul>';
      }
      return `<li>${name}${children}</li>`;
    };
    return '<ul style="font-size:13px;line-height:1.6">' + tree.map(buildNode).join('') + '</ul>';
  }
};
