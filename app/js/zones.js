// Zones module - learning zone CRUD + file upload + AI analyze + card generation
const Zones = {
  currentZoneId: null,
  pendingAnalyzeFileIds: null,
  speedRef: null,

  // --- Home page: list all zones ---
  async renderHome() {
    const tpl = document.getElementById('tpl-home');
    App.setPage(tpl);

    try {
      const data = await API.get('/api/zones');
      const list = data.zones || [];
      const listEl = document.getElementById('zone-list');
      const emptyEl = document.getElementById('zone-empty');
      const pinnedSection = document.getElementById('pinned-zone-section');
      const pinnedList = document.getElementById('pinned-zone-list');
      const pinned = list.filter(z => z.pinned);
      const normal = list.filter(z => !z.pinned);

      if (list.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        if (pinnedSection) pinnedSection.classList.add('hidden');
      } else {
        emptyEl.classList.add('hidden');
        if (pinnedSection && pinnedList) {
          if (pinned.length) {
            pinnedSection.classList.remove('hidden');
            pinnedList.innerHTML = pinned.map(z => this.zoneCardHtml(z)).join('');
            this.bindZoneCards(pinnedList);
          } else {
            pinnedSection.classList.add('hidden');
          }
        }
        listEl.innerHTML = normal.map(z => this.zoneCardHtml(z)).join('');
        this.bindZoneCards(listEl);
      }

      document.getElementById('btn-new-zone').onclick = () => this.showCreateModal();
      document.getElementById('btn-settings').onclick = () => App.navigate('settings');
      document.getElementById('btn-logout').onclick = () => this.handleLogout();
      this.renderDesktopHero(list);
      await this.renderCalendar('home-calendar', null);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  async renderCalendar(containerId, zoneId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const data = await API.get(`/api/calendar${zoneId ? `?zone_id=${zoneId}` : ''}`);
      const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
      const firstWeekday = new Date(data.year, data.month - 1, 1).getDay();
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push('<span class="cal-empty"></span>');
      cells.push(...data.days.map((d) => `
        <span class="cal-day ${d.done ? 'done' : d.future ? 'future' : 'miss'}">${d.day}${d.done ? ' ✓' : d.future ? '' : ' ✕'}</span>
      `));
      el.innerHTML = `
        <div class="calendar-card">
          <div class="calendar-head">
            <strong>${data.year} 年 ${data.month} 月</strong>
            <span class="streak">🔥 学习日历</span>
          </div>
          <div class="cal-weekdays">${weekdayNames.map((n) => `<span>${n}</span>`).join('')}</div>
          <div class="cal-grid">${cells.join('')}</div>
          <div class="calendar-foot">✓ 当天完成至少一个关卡 · ✕ 当天未完成</div>
          ${containerId === 'home-calendar' ? `
            <div class="calendar-notify">
              <label>提醒时间 <input type="time" id="calendar-notify-time" value="${Utils.esc(data.notify_time || '19:30')}"></label>
              <label><input type="checkbox" id="calendar-notify-enabled" ${data.notify_enabled ? 'checked' : ''}> 开启每日提醒</label>
              <button class="btn btn-outline btn-sm" id="btn-save-calendar-notify">保存提醒</button>
            </div>
          ` : ''}
        </div>
      `;
      const notifyBtn = el.querySelector('#btn-save-calendar-notify');
      if (notifyBtn) {
        notifyBtn.onclick = async () => {
          try {
            const enabled = !!el.querySelector('#calendar-notify-enabled').checked;
            const time = el.querySelector('#calendar-notify-time').value || '19:30';
            await API.put('/api/calendar', { notify_time: time, notify_enabled: enabled });
            if (enabled && typeof Notification !== 'undefined' && Notification.requestPermission) {
              await Notification.requestPermission();
            }
            Toast.show('日历提醒设置已保存', 'success');
          } catch (e) {
            Toast.show(e.message, 'error');
          }
        };
      }
      el.classList.remove('hidden');
    } catch (e) {
      el.classList.add('hidden');
    }
  },

  renderDesktopHero(list) {
    const el = document.getElementById('desktop-hero');
    if (!el) return;
    const totalCards = list.reduce((sum, z) => sum + (z.card_count || 0), 0);
    const doneCards = list.reduce((sum, z) => sum + (z.success_count || 0), 0);
    const pct = totalCards ? Math.round((doneCards / totalCards) * 100) : 0;
    const now = new Date();
    const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="hero-copy">
        <span class="hero-eyebrow">${dateLabel} · 本地学习空间</span>
        <h2>把资料变成可闯关的知识卡片</h2>
        <p>上传文件 → AI 生成卡片 → 每日闯关与错题复习</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><strong>${list.length}</strong><span>学习区</span></div>
        <div class="hero-stat"><strong>${totalCards}</strong><span>知识卡片</span></div>
        <div class="hero-stat"><strong>${doneCards}</strong><span>已通关</span></div>
      </div>
      <div class="hero-ring" style="--pct:${pct}">
        <div class="hero-ring-inner"><strong>${pct}%</strong><span>总进度</span></div>
      </div>
    `;
  },

  async handleLogout() {
    try {
      await Auth.logout();
      Toast.show('本地模式无需登录，已返回首页', 'success');
      App.navigate('home');
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  // Create zone modal
  showCreateModal() {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    const now = new Date();
    const defaultName = `学习区 ${now.getMonth()+1}月${now.getDate()}日`;

    box.innerHTML = `
      <h3>新建学习区</h3>
      <input type="text" id="zone-name-input" placeholder="${defaultName}" value="">
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">创建</button>
      </div>
    `;
    modal.classList.remove('hidden');

    const input = document.getElementById('zone-name-input');
    input.focus();

    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      const name = input.value.trim() || defaultName;
      modal.classList.add('hidden');
      try {
        await API.post('/api/zones', { name });
        Toast.show('学习区已创建', 'success');
        this.renderHome();
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };

    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('modal-confirm').click();
    });
  },

  // --- Zone detail page ---
  async renderZone(zoneId) {
    this.currentZoneId = zoneId;
    const tpl = document.getElementById('tpl-zone-detail');
    App.setPage(tpl);

    document.getElementById('btn-back-home').onclick = () => App.navigate('home');

    document.getElementById('btn-upload').onclick = () => App.navigate('upload', zoneId);
    document.getElementById('btn-ai-trend').onclick = () => App.navigate('ai', zoneId);
    document.getElementById('btn-wrong').onclick = () => App.navigate('wrong', zoneId);

    await this.loadZoneDetail(zoneId);
  },

  // Dedicated upload page with allowed types and confirm step
  async renderUpload(zoneId) {
    this.currentZoneId = zoneId;
    const tpl = document.getElementById('tpl-upload');
    App.setPage(tpl);
    document.getElementById('btn-back-upload').onclick = () => App.navigate('zone', zoneId);

    const input = document.getElementById('upload-file-input');
    const nameEl = document.getElementById('upload-file-name');
    const confirmBtn = document.getElementById('btn-upload-confirm');
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      nameEl.innerHTML = files.map(f => `
        <div class="upload-file-row">${Utils.esc(f.name)} · ${Utils.formatSize(f.size)}</div>
      `).join('');
      confirmBtn.disabled = files.length === 0;
    });
    confirmBtn.onclick = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '上传中...';
      let saved = 0;
      const savedIds = [];
      for (const file of files) {
        try {
          const res = await API.upload(`/api/zones/${zoneId}/files`, file);
          saved++;
          if (res && res.id) savedIds.push(res.id);
        } catch (e) {
          Toast.show(e.message, 'error');
        }
      }
      if (saved > 0) Toast.show(`已保存 ${saved} 个文件`, 'success');
      if (saved > 0) {
        this.pendingAnalyzeFileIds = savedIds;
        this.showAnalyzePrompt(zoneId);
      } else {
        App.navigate('zone', zoneId);
      }
    };
  },

  zoneCardHtml(z) {
    return `
      <div class="zone-card-wrap ${z.pinned ? 'pinned' : ''}" data-zone-id="${z.id}">
        <div class="zone-actions">
          <button class="zone-action-pin" data-act="pin" data-id="${z.id}">${z.pinned ? '取消置顶' : '置顶'}</button>
          <button class="zone-action-delete" data-act="delete" data-id="${z.id}">删除</button>
        </div>
        <div class="zone-card">
          <div class="zone-card-top">
            <span class="zone-card-name">${Utils.esc(z.name)}</span>
            <span class="zone-card-status ${z.status === '已完成' ? 'status-done' : 'status-active'}">${Utils.esc(z.status)}</span>
          </div>
          <div class="zone-card-meta">
            <span>卡片 ${z.card_count || 0}</span>
            <span>已通关 ${z.success_count || 0}</span>
            <span>${Utils.timeAgo(z.updated_at)}</span>
          </div>
        </div>
      </div>
    `;
  },

  bindZoneCards(container) {
    container.querySelectorAll('.zone-card-wrap').forEach(wrap => {
      const zoneId = parseInt(wrap.dataset.zoneId, 10);
      wrap.querySelector('.zone-card').addEventListener('click', () => {
        this.currentZoneId = zoneId;
        App.navigate('zone', zoneId);
      });
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        wrap.classList.toggle('show-actions');
      });
      let touchStartX = null;
      wrap.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      wrap.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (dx > 40) wrap.classList.add('show-actions');
        if (dx < -40) wrap.classList.remove('show-actions');
        touchStartX = null;
      });
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) wrap.classList.remove('show-actions');
      });
      wrap.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'pin') {
            try {
              await API.post(`/api/zones/${zoneId}/pin`, { pinned: !wrap.classList.contains('pinned') });
              this.renderHome();
            } catch (err) {
              Toast.show(err.message, 'error');
            }
          } else if (act === 'delete') {
            if (!window.confirm('确定删除该学习区？学习区、卡片和进度会一并清空。')) return;
            try {
              await API.delete(`/api/zones/${zoneId}`);
              Toast.show('学习区已删除', 'success');
              this.renderHome();
            } catch (err) {
              Toast.show(err.message, 'error');
            }
          }
        });
      });
    });
  },

  showAnalyzePrompt(zoneId) {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3>文件已上传</h3>
      <p style="font-size:0.9rem;color:#64748b;margin-bottom:16px;">是否立即进行 AI 分析并生成知识卡片？</p>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">稍后分析</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">立即分析</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => {
      modal.classList.add('hidden');
      this.pendingAnalyzeFileIds = null;
      App.navigate('zone', zoneId);
    };
    document.getElementById('modal-confirm').onclick = () => {
      modal.classList.add('hidden');
      App.navigate('ai', zoneId);
    };
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        this.pendingAnalyzeFileIds = null;
        App.navigate('zone', zoneId);
      }
    };
  },

  // Dedicated AI trend analysis / generation page
  async renderAi(zoneId) {
    this.currentZoneId = zoneId;
    this.aiPoints = [];
    this.oldCards = [];
    this.refineMode = false;
    this.refineState = null;
    const tpl = document.getElementById('tpl-ai');
    App.setPage(tpl);
    document.getElementById('btn-back-ai').onclick = () => App.navigate('zone', zoneId);
    document.getElementById('btn-ai-analyze').onclick = () => this.handleAiAnalyze(zoneId);
    document.getElementById('btn-ai-regenerate').onclick = () => this.handleAiAnalyze(zoneId);
    document.getElementById('btn-ai-confirm').onclick = () => this.handleAiGenerate(zoneId);
    document.querySelectorAll('.ai-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.refineMode = btn.dataset.mode === 'refine';
        document.querySelectorAll('.ai-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        const stage = document.getElementById('refine-stage');
        const options = document.getElementById('refine-options');
        if (options) options.classList.toggle('hidden', !this.refineMode);
        if (stage) stage.classList.add('hidden');
        this.refineState = null;
        this.aiPoints = [];
        const hint = document.getElementById('ai-start-hint');
        if (hint) {
          hint.textContent = this.refineMode
            ? '四阶段精炼：结构分析 → 延伸补充 → 结构化拆解 → 生成卡片'
            : '点击下方按钮开始分析';
        }
      });
    });
    document.querySelectorAll('input[name="replace-old"]').forEach(radio => {
      radio.addEventListener('change', () => this.toggleAiSelect());
    });
    await this.loadAiFiles(zoneId);
    const fileIds = Array.from(document.querySelectorAll('.ai-file-check:checked')).map(cb => parseInt(cb.dataset.id, 10));
    await this.renderSpeedSelector(zoneId, fileIds);
    await this.loadAIHistory(zoneId);
    // Add "Dialogue mode" button
    const chatBtn = document.createElement('div');
    chatBtn.innerHTML = '<button class="btn btn-outline btn-block" id="btn-ai-chat" style="margin-top:10px">💬 切换到对话式分析</button>';
    document.querySelector('.ai-actions')?.appendChild(chatBtn.firstElementChild);
    const btnChat = document.getElementById('btn-ai-chat');
    if (btnChat) btnChat.onclick = () => App.navigate('ai-chat', zoneId);
  },

  async loadAIHistory(zoneId) {
    const panel = document.getElementById('ai-history-panel');
    const list = document.getElementById('ai-history-list');
    if (!panel || !list) return;
    try {
      const data = await API.get(`/api/zones/${zoneId}/ai-history`);
      const items = data.items || [];
      if (!items.length) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');
      list.innerHTML = items.map((item) => `
        <div class="ai-history-item">
          <span style="flex:1">${Utils.esc(item.created_at || '')} · ${Utils.esc(item.type || '')} · ${Utils.esc(item.summary || '')}</span>
          <button class="btn btn-outline btn-sm" data-history-view="${Utils.esc(item.id)}">查看记录</button>
          <button class="btn btn-primary btn-sm" data-history-use="${Utils.esc(item.id)}">直接使用</button>
        </div>
      `).join('');
      list.querySelectorAll('[data-history-view]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const row = await API.get(`/api/zones/${zoneId}/ai-history/${btn.dataset.historyView}`);
            this.showAIHistoryModal(row);
          } catch (e) {
            Toast.show(e.message, 'error');
          }
        };
      });
      list.querySelectorAll('[data-history-use]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const row = await API.get(`/api/zones/${zoneId}/ai-history/${btn.dataset.historyUse}`);
            this.applyAIHistory(zoneId, row.payload || {});
          } catch (e) {
            Toast.show(e.message, 'error');
          }
        };
      });
    } catch (e) {
      panel.classList.add('hidden');
    }
  },

  showAIHistoryModal(row) {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    const preview = JSON.stringify(row.payload || {}, null, 2).slice(0, 2000);
    box.innerHTML = `
      <h3>AI 历史记录</h3>
      <p class="muted" style="font-size:0.85rem">${Utils.esc(row.created_at || '')} · ${Utils.esc(row.type || '')}</p>
      <pre style="white-space:pre-wrap;word-break:break-all;font-size:0.75rem;max-height:260px;overflow:auto;background:#f8fafc;border-radius:8px;padding:10px;">${Utils.esc(preview)}</pre>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">关闭</button>
        <button class="btn btn-primary btn-sm" id="modal-use-history">使用此版本</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-use-history').onclick = () => {
      modal.classList.add('hidden');
      this.applyAIHistory(this.currentZoneId, row.payload || {});
    };
  },

  applyAIHistory(zoneId, payload) {
    if (payload.knowledge_points && Array.isArray(payload.knowledge_points)) {
      this.aiPoints = payload.knowledge_points;
      this.renderAiResult(zoneId);
      Toast.show('已使用该 AI 历史版本', 'success');
    } else {
      Toast.show('该历史记录暂不支持一键使用', 'error');
    }
  },

  renderAiResult(zoneId) {
    const resultEl = document.getElementById('ai-result');
    if (!resultEl) return;
    const groups = {};
    this.aiPoints.forEach(p => {
      const block = p.block_name || '全部知识点';
      (groups[block] = groups[block] || []).push(p);
    });
    resultEl.innerHTML = Object.entries(groups).map(([block, points]) => `
      <div class="ai-block">
        <div class="ai-block-head">${Utils.esc(block)} <span>${points.length} 个知识点</span></div>
        ${points.map(p => `
          <div class="ai-point">
            <span class="ai-difficulty diff-${({ '易': 'easy', '中': 'mid', '难': 'hard' })[p.difficulty] || 'mid'}">${Utils.esc(p.difficulty || '中')}</span>
            <div>
              <div class="ai-point-title">${Utils.esc(p.title)}</div>
              <div class="ai-point-desc">${Utils.esc(p.description || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
    resultEl.classList.remove('hidden');
    document.getElementById('ai-import-options').classList.remove('hidden');
    document.getElementById('btn-ai-confirm').classList.remove('hidden');
    document.getElementById('btn-ai-analyze').classList.add('hidden');
    document.getElementById('btn-ai-regenerate').classList.remove('hidden');
  },

  async saveAIHistory(zoneId, type, payload) {
    try {
      await API.post(`/api/zones/${zoneId}/ai-history`, { type, payload });
      await this.loadAIHistory(zoneId);
    } catch (e) {
      // history is best-effort
    }
  },

  async loadAiFiles(zoneId) {
    const listEl = document.getElementById('ai-file-list');
    if (!listEl) return;
    try {
      const data = await API.get(`/api/zones/${zoneId}`);
      const files = data.files || [];
      const pendingSet = new Set((this.pendingAnalyzeFileIds || []).map(Number));
      this.pendingAnalyzeFileIds = null;
      if (!files.length) {
        listEl.innerHTML = '<div class="ai-select-empty">当前没有文件，请先上传文件</div>';
        return;
      }
      listEl.innerHTML = files.map(f => `
        <label class="ai-select-item">
          <input type="checkbox" class="ai-file-check" data-id="${f.id}" ${pendingSet.size ? (pendingSet.has(f.id) ? 'checked' : '') : 'checked'}>
          <span class="ai-select-title">${Utils.esc(f.filename)}</span>
          <span class="ai-select-meta">${Utils.formatSize(f.size)}</span>
        </label>
      `).join('');
    } catch (e) {
      listEl.innerHTML = `<div class="ai-select-empty">${Utils.esc(e.message)}</div>`;
    }
  },

  toggleAiSelect() {
    const replace = document.querySelector('input[name="replace-old"]:checked')?.value || 'none';
    const selectBox = document.getElementById('ai-select-cards');
    if (selectBox) selectBox.classList.toggle('hidden', replace !== 'selected');
  },

  async loadOldCardsForSelect(zoneId) {
    const listEl = document.getElementById('ai-select-list');
    if (!listEl) return;
    try {
      const data = await API.get(`/api/zones/${zoneId}/cards`);
      this.oldCards = data.cards || [];
      if (this.oldCards.length === 0) {
        listEl.innerHTML = '<div class="ai-select-empty">当前没有旧卡片</div>';
        return;
      }
      listEl.innerHTML = this.oldCards.map(c => `
        <label class="ai-select-item">
          <input type="checkbox" class="ai-select-check" data-id="${c.id}">
          <span class="ai-select-title">${Utils.esc(c.title)}</span>
          <span class="ai-select-meta">${Utils.esc(c.label)}</span>
        </label>
      `).join('');
    } catch (e) {
      listEl.innerHTML = `<div class="ai-select-empty">${Utils.esc(e.message)}</div>`;
    }
  },

  profileByMultiplier(multiplier) {
    const profiles = {
      1: { multiplier: 1, analyzeConcurrency: 1, generateConcurrency: 1, cardBatchSize: 1 },
      5: { multiplier: 5, analyzeConcurrency: 5, generateConcurrency: 5, cardBatchSize: 5 },
      10: { multiplier: 10, analyzeConcurrency: 10, generateConcurrency: 10, cardBatchSize: 10 },
      20: { multiplier: 20, analyzeConcurrency: 20, generateConcurrency: 20, cardBatchSize: 10 }
    };
    return profiles[Number(multiplier)] || profiles[1];
  },

  async recommendedProfileForFileIds(zoneId, fileIds) {
    try {
      const [settings, zone] = await Promise.all([
        API.get('/api/settings'),
        API.get(`/api/zones/${zoneId}`)
      ]);
      const files = (zone.files || []).filter((f) => fileIds.includes(f.id));
      const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
      return { profile: LocalAIInstance.resolveSpeedProfile(settings, totalBytes), totalBytes };
    } catch (e) {
      return { profile: this.profileByMultiplier(1), totalBytes: 0 };
    }
  },

  async renderSpeedSelector(zoneId, fileIds) {
    const select = document.getElementById('ai-speed-select');
    const hint = document.getElementById('ai-speed-hint');
    if (!select || !hint) return;
    const { profile, totalBytes } = await this.recommendedProfileForFileIds(zoneId, fileIds);
    const recommended = profile.multiplier === 1 ? '普通' : `${profile.multiplier}倍`;
    const sizeLabel = totalBytes < 1024 ? `${totalBytes}B` : totalBytes < 1024 * 1024 ? `${Math.round(totalBytes / 1024)}KB` : `${(totalBytes / (1024 * 1024)).toFixed(1)}MB`;
    select.value = 'auto';
    hint.textContent = `推荐：${recommended}（文件约 ${sizeLabel}）。可手动切换，切换后剩余任务会使用新档位。`;
    select.onchange = () => {
      if (this.speedRef) {
        const multiplier = select.value === 'auto'
          ? profile.multiplier
          : Number(select.value);
        this.speedRef.value = this.profileByMultiplier(multiplier);
        if (this.speedRef.ensureWorkers) this.speedRef.ensureWorkers();
        const label = this.speedRef.value.multiplier === 1 ? '普通' : `${this.speedRef.value.multiplier}倍`;
        hint.textContent = `已切换：${label}，剩余任务将按新档位执行。`;
      }
    };
  },

  selectedSpeedProfile() {
    const select = document.getElementById('ai-speed-select');
    if (!select) return this.profileByMultiplier(1);
    return this.profileByMultiplier(select.value === 'auto' ? 1 : Number(select.value));
  },

  async handleAiAnalyze(zoneId) {
    if (this.refineMode) {
      return this.handleRefineStage1(zoneId);
    }
    const chat = document.getElementById('ai-chat');
    const resultEl = document.getElementById('ai-result');
    const analyzeBtn = document.getElementById('btn-ai-analyze');
    const regenerateBtn = document.getElementById('btn-ai-regenerate');
    const confirmBtn = document.getElementById('btn-ai-confirm');
    const progressWrap = document.getElementById('ai-analyze-progress');
    const fileIds = Array.from(document.querySelectorAll('.ai-file-check:checked')).map(cb => parseInt(cb.dataset.id, 10));
    if (!fileIds.length) {
      Toast.show('请至少选择一个文件', 'error');
      return;
    }
    analyzeBtn.disabled = true;
    regenerateBtn.disabled = true;
    resultEl.classList.add('hidden');
    resultEl.innerHTML = '';
    const rec = await this.recommendedProfileForFileIds(zoneId, fileIds);
    const select = document.getElementById('ai-speed-select');
    const profile = (!select || select.value === 'auto') ? rec.profile : this.profileByMultiplier(Number(select.value));
    const speedRef = { value: profile };
    this.speedRef = speedRef;
    const tierLabel = profile.multiplier === 1 ? '普通' : `${profile.multiplier}倍`;
    const taskEstimate = Math.max(1, Math.ceil((rec.totalBytes || 0) / 60000));
    chat.innerHTML += `<div class="ai-msg ai-msg-bot">正在按 ${tierLabel} 档位分析选中的文件（约 ${taskEstimate} 个分析任务），请稍候...</div>`;
    if (progressWrap) progressWrap.classList.remove('hidden');

    try {
      const data = await API.post(`/api/zones/${zoneId}/analyze`, {
        file_ids: fileIds,
        speedRef,
        onProgress: (done, total) => this.updateAiProgress('ai-analyze-bar', 'ai-analyze-text', done, total, `${tierLabel} 档`)
      });
      this.aiPoints = data.knowledge_points || [];
      this.saveAIHistory(zoneId, 'analyze', {
        knowledge_points: this.aiPoints,
        summary: `${this.aiPoints.length} 条知识点`
      });
      if (progressWrap) progressWrap.classList.add('hidden');
      if (this.aiPoints.length === 0) {
        chat.innerHTML += '<div class="ai-msg ai-msg-bot">没有识别到知识点，请换一份资料重试。</div>';
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '重新分析';
        return;
      }
      const groups = {};
      this.aiPoints.forEach(p => {
        const block = p.block_name || '全部知识点';
        (groups[block] = groups[block] || []).push(p);
      });
      resultEl.innerHTML = Object.entries(groups).map(([block, points]) => `
        <div class="ai-block">
          <div class="ai-block-head">${Utils.esc(block)} <span>${points.length} 个知识点</span></div>
          ${points.map(p => `
            <div class="ai-point">
              <span class="ai-difficulty diff-${({ '易': 'easy', '中': 'mid', '难': 'hard' })[p.difficulty] || 'mid'}">${Utils.esc(p.difficulty || '中')}</span>
              <div>
                <div class="ai-point-title">${Utils.esc(p.title)}</div>
                <div class="ai-point-desc">${Utils.esc(p.description || '')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
      resultEl.classList.remove('hidden');
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">分析完成，共 ${this.aiPoints.length} 条知识点，已按区块分类。请确认后生成卡片。</div>`;
      document.getElementById('ai-import-options').classList.remove('hidden');
      await this.loadOldCardsForSelect(zoneId);
      regenerateBtn.classList.remove('hidden');
      regenerateBtn.disabled = false;
      confirmBtn.classList.remove('hidden');
      analyzeBtn.classList.add('hidden');
    } catch (e) {
      if (progressWrap) progressWrap.classList.add('hidden');
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">分析失败：${Utils.esc(e.message)}</div>`;
      analyzeBtn.disabled = false;
    }
  },

  async handleRefineStage1(zoneId) {
    const chat = document.getElementById('ai-chat');
    const stage = document.getElementById('refine-stage');
    const analyzeBtn = document.getElementById('btn-ai-analyze');
    const regenerateBtn = document.getElementById('btn-ai-regenerate');
    const confirmBtn = document.getElementById('btn-ai-confirm');
    const progressWrap = document.getElementById('ai-analyze-progress');
    const fileIds = Array.from(document.querySelectorAll('.ai-file-check:checked')).map((cb) => parseInt(cb.dataset.id, 10));
    if (!fileIds.length) {
      Toast.show('请至少选择一个文件', 'error');
      return;
    }
    analyzeBtn.disabled = true;
    if (regenerateBtn) regenerateBtn.disabled = true;
    stage.classList.add('hidden');
    stage.innerHTML = '';
    const rec = await this.recommendedProfileForFileIds(zoneId, fileIds);
    const select = document.getElementById('ai-speed-select');
    const profile = (!select || select.value === 'auto') ? rec.profile : this.profileByMultiplier(Number(select.value));
    const speedRef = { value: profile };
    this.speedRef = speedRef;
    const tierLabel = profile.multiplier === 1 ? '普通' : `${profile.multiplier}倍`;
    chat.innerHTML += `<div class="ai-msg ai-msg-bot">第一阶段：正在按 ${tierLabel} 档分析结构与范围...</div>`;
    if (progressWrap) progressWrap.classList.remove('hidden');
    try {
      const data = await API.post(`/api/zones/${zoneId}/refine/analyze`, {
        file_ids: fileIds,
        speedRef,
        onProgress: (done, total) => this.updateAiProgress('ai-analyze-bar', 'ai-analyze-text', done, total, `${tierLabel} 档`)
      });
      if (progressWrap) progressWrap.classList.add('hidden');
      this.refineState = {
        scope: data.scope || '',
        outline: data.outline || [],
        issues: data.issues || [],
        points: data.knowledge_points || [],
        acceptedIssues: new Set((data.issues || []).map((_, i) => i)),
        extensions: [],
        keptExtensions: new Set(),
        tree: null,
        decomposedPoints: [],
        mergedPoints: [],
        sortMode: 'easy_to_hard'
      };
      if (!this.refineState.points.length) {
        chat.innerHTML += '<div class="ai-msg ai-msg-bot">没有识别到知识点，请换一份资料重试。</div>';
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '重新分析';
        return;
      }
      this.renderRefineStage1(zoneId);
      analyzeBtn.classList.add('hidden');
      if (regenerateBtn) {
        regenerateBtn.classList.remove('hidden');
        regenerateBtn.disabled = false;
      }
      if (confirmBtn) confirmBtn.classList.add('hidden');
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">结构分析完成：${this.refineState.points.length} 条知识点，${this.refineState.issues.length} 条疑似错误。请审阅后进入延伸补充。</div>`;
    } catch (e) {
      if (progressWrap) progressWrap.classList.add('hidden');
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">分析失败：${Utils.esc(e.message)}</div>`;
      analyzeBtn.disabled = false;
    }
  },

  renderRefineStage1(zoneId) {
    const stage = document.getElementById('refine-stage');
    const s = this.refineState;
    const issuesHtml = s.issues.length
      ? s.issues.map((item, i) => `
          <div class="refine-issue ${s.acceptedIssues.has(i) ? '' : 'ignored'}">
            <div class="refine-issue-head">
              <label><input type="checkbox" class="refine-issue-check" data-idx="${i}" ${s.acceptedIssues.has(i) ? 'checked' : ''}> 采纳</label>
              <span class="refine-issue-title">${Utils.esc(item.issue)}</span>
            </div>
            <div class="refine-issue-source">原文：${Utils.esc(item.source || '')}</div>
            <div class="refine-issue-reason">理由：${Utils.esc(item.reason || '')}</div>
            <div class="refine-issue-suggestion">建议：${Utils.esc(item.suggestion || '')}</div>
          </div>
        `).join('')
      : '<div class="refine-none">未发现疑似错误</div>';
    stage.innerHTML = `
      <div class="refine-section">
        <div class="refine-section-title">第一阶段 · 结构范围分析</div>
        <div class="refine-scope">${Utils.esc(s.scope || '')}</div>
        <div class="refine-outline">${(s.outline || []).map((item) => `<div>${Utils.esc(item)}</div>`).join('')}</div>
      </div>
      <div class="refine-section">
        <div class="refine-section-title">疑似错误清单（${s.issues.length}）</div>
        ${issuesHtml}
      </div>
      <div class="refine-actions">
        <button class="btn btn-outline btn-block" id="btn-refine-stage1-regenerate">重新生成第一阶段</button>
        <button class="btn btn-primary btn-block" id="btn-refine-stage2">确认结构，进入延伸补充</button>
      </div>
    `;
    stage.classList.remove('hidden');
    stage.querySelectorAll('.refine-issue-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const idx = Number(cb.dataset.idx);
        if (cb.checked) s.acceptedIssues.add(idx);
        else s.acceptedIssues.delete(idx);
        cb.closest('.refine-issue').classList.toggle('ignored', !cb.checked);
      });
    });
    document.getElementById('btn-refine-stage2').onclick = () => this.handleRefineStage2(zoneId);
    document.getElementById('btn-refine-stage1-regenerate').onclick = () => this.handleRefineStage1(zoneId);
  },

  async handleRefineStage2(zoneId) {
    const chat = document.getElementById('ai-chat');
    const stage = document.getElementById('refine-stage');
    const maxInput = document.getElementById('refine-max-items');
    const maxItems = maxInput ? Number(maxInput.value) || 8 : 8;
    stage.classList.add('hidden');
    chat.innerHTML += '<div class="ai-msg ai-msg-bot">第二阶段：正在生成延伸补充内容...</div>';
    try {
      const data = await API.post(`/api/zones/${zoneId}/refine/extend`, {
        points: this.refineState.points,
        max_items: maxItems
      });
      this.refineState.extensions = data.extensions || [];
      this.refineState.keptExtensions = new Set(this.refineState.extensions.map((e) => e.id));
      this.renderRefineStage2(zoneId);
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">延伸补充完成：${this.refineState.extensions.length} 条。可逐条取舍，或整块跳过。</div>`;
    } catch (e) {
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">延伸补充失败：${Utils.esc(e.message)}</div>`;
    }
  },

  renderRefineStage2(zoneId) {
    const stage = document.getElementById('refine-stage');
    const s = this.refineState;
    const itemsHtml = s.extensions.length
      ? s.extensions.map((item) => `
          <div class="refine-extension">
            <label class="refine-extension-head">
              <input type="checkbox" class="refine-ext-check" data-id="${Utils.esc(item.id)}" ${s.keptExtensions.has(item.id) ? 'checked' : ''}>
              <span class="refine-ext-category">${Utils.esc(item.category)}</span>
              <span class="refine-ext-title">${Utils.esc(item.title)}</span>
            </label>
            <div class="refine-ext-content">${Utils.esc(item.content || '')}</div>
            <div class="refine-ext-reason">补充理由：${Utils.esc(item.reason || '')}</div>
          </div>
        `).join('')
      : '<div class="refine-none">没有生成延伸内容，可直接进入下一步。</div>';
    stage.innerHTML = `
      <div class="refine-section">
        <div class="refine-section-title">第二阶段 · 知识延伸与补充（${s.extensions.length}）</div>
        ${itemsHtml}
      </div>
      <div class="refine-actions">
        <button class="btn btn-outline btn-block" id="btn-refine-stage2-regenerate">重新生成第二阶段</button>
        <button class="btn btn-outline btn-block" id="btn-refine-skip-ext">整块跳过</button>
        <button class="btn btn-primary btn-block" id="btn-refine-stage3">确认延伸，进入结构化拆解</button>
      </div>
    `;
    stage.classList.remove('hidden');
    stage.querySelectorAll('.refine-ext-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) s.keptExtensions.add(cb.dataset.id);
        else s.keptExtensions.delete(cb.dataset.id);
      });
    });
    document.getElementById('btn-refine-skip-ext').onclick = () => {
      s.keptExtensions = new Set();
      this.handleRefineStage3(zoneId);
    };
    document.getElementById('btn-refine-stage3').onclick = () => this.handleRefineStage3(zoneId);
    document.getElementById('btn-refine-stage2-regenerate').onclick = () => this.handleRefineStage2(zoneId);
  },

  async handleRefineStage3(zoneId) {
    const chat = document.getElementById('ai-chat');
    const stage = document.getElementById('refine-stage');
    stage.classList.add('hidden');
    const s = this.refineState;
    const merged = [...s.points];
    (s.extensions || []).forEach((item) => {
      if (!s.keptExtensions.has(item.id)) return;
      merged.push({ title: item.title, description: item.content, block_name: item.category, source_type: 'extension' });
    });
    chat.innerHTML += '<div class="ai-msg ai-msg-bot">第三阶段：正在把知识拆解为原子条目并构建知识树...</div>';
    try {
      const data = await API.post(`/api/zones/${zoneId}/refine/decompose`, { points: merged });
      s.tree = data.tree || [];
      s.decomposedPoints = data.points || [];
      s.mergedPoints = merged;
      this.renderRefineStage3(zoneId);
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">结构化拆解完成：${s.decomposedPoints.length} 条原子知识点。请选择排序方式。</div>`;
    } catch (e) {
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">结构化拆解失败：${Utils.esc(e.message)}</div>`;
    }
  },

  renderRefineStage3(zoneId) {
    const stage = document.getElementById('refine-stage');
    const s = this.refineState;
    stage.innerHTML = `
      <div class="refine-section">
        <div class="refine-section-title">第三阶段 · 知识树（${s.decomposedPoints.length} 条原子知识点）</div>
        <div class="refine-tree">${this.refineTreeHtml(s.tree)}</div>
      </div>
      <div class="refine-section">
        <div class="refine-section-title">选择排序方式</div>
        <div class="sort-mode-control">
          <button class="sort-mode-btn active" data-sort="easy_to_hard">由易到难</button>
          <button class="sort-mode-btn" data-sort="block">按结构</button>
        </div>
      </div>
      <div class="refine-actions">
        <button class="btn btn-outline btn-block" id="btn-refine-stage3-regenerate">重新生成第三阶段</button>
        <button class="btn btn-success btn-block" id="btn-refine-generate">确认排序并生成卡片</button>
      </div>
    `;
    stage.classList.remove('hidden');
    stage.querySelectorAll('.sort-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        s.sortMode = btn.dataset.sort;
        stage.querySelectorAll('.sort-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    document.getElementById('btn-refine-generate').onclick = () => this.handleRefineGenerate(zoneId);
    document.getElementById('btn-refine-stage3-regenerate').onclick = () => this.handleRefineStage3(zoneId);
  },

  refineTreeHtml(tree) {
    if (!Array.isArray(tree) || !tree.length) return '<div class="refine-none">知识树为空</div>';
    return '<ul>' + tree.map((node) => this.refineNodeHtml(node)).join('') + '</ul>';
  },

  refineNodeHtml(node) {
    const name = Utils.esc((node && node.name) || '未命名');
    const structures = (node && node.structures) || [];
    const blocks = (node && node.blocks) || [];
    let children = '';
    if (structures.length) {
      children = '<ul>' + structures.map((n) => this.refineNodeHtml(n)).join('') + '</ul>';
    } else if (blocks.length) {
      children = '<ul>' + blocks.map((block) => {
        const points = (block.points || []).map((p) => `<li class="refine-point">${Utils.esc(p.title)}</li>`).join('');
        return `<li>${Utils.esc((block && block.name) || '未分区')}${points ? '<ul>' + points + '</ul>' : ''}</li>`;
      }).join('') + '</ul>';
    }
    return `<li>${name}${children}</li>`;
  },

  async handleRefineGenerate(zoneId) {
    const s = this.refineState;
    if (!s || !s.decomposedPoints.length) return;
    try {
      await API.put(`/api/zones/${zoneId}/settings`, { sort_mode: s.sortMode });
    } catch (e) {
      // sort is best effort here
    }
    const order = { 易: 0, 中: 1, 难: 2 };
    const points = s.decomposedPoints.slice();
    if (s.sortMode === 'block') {
      points.sort(
        (a, b) =>
          String(a.path || '').localeCompare(String(b.path || '')) ||
          (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1)
      );
    } else {
      points.sort(
        (a, b) =>
          (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1) ||
          String(a.path || '').localeCompare(String(b.path || ''))
      );
    }
    this.aiPoints = points;
    await this.saveAIHistory(zoneId, 'refine', {
      knowledge_points: points,
      summary: `${points.length} 条精炼知识点`
    });
    await this.handleAiGenerate(zoneId);
  },

  updateAiProgress(barId, textId, done, total, prefix) {
    const bar = document.getElementById(barId);
    const text = document.getElementById(textId);
    if (!bar || !text) return;
    const pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = `${prefix ? prefix + ' · ' : ''}进度 ${done}/${total}（${pct}%）`;
  },

  async handleAiGenerate(zoneId) {
    if (!this.aiPoints.length) return;
    const confirmBtn = document.getElementById('btn-ai-confirm');
    const chat = document.getElementById('ai-chat');
    const progressWrap = document.getElementById('ai-gen-progress');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '生成中...';
    const fileIds = Array.from(new Set((this.aiPoints || []).map((p) => p.file_id).filter(Boolean)));
    const rec = await this.recommendedProfileForFileIds(zoneId, fileIds);
    const select = document.getElementById('ai-speed-select');
    const profile = (!select || select.value === 'auto') ? rec.profile : this.profileByMultiplier(Number(select.value));
    const speedRef = { value: profile };
    this.speedRef = speedRef;
    const tierLabel = profile.multiplier === 1 ? '普通' : `${profile.multiplier}倍`;
    const batchCount = Math.max(1, Math.ceil((this.aiPoints.length || 0) / profile.cardBatchSize));
    chat.innerHTML += `<div class="ai-msg ai-msg-bot">正在按 ${tierLabel} 档位生成卡片（${this.aiPoints.length} 张，约 ${batchCount} 批），每一条知识点一张卡片...</div>`;
    if (progressWrap) progressWrap.classList.remove('hidden');
    const groups = {};
    this.aiPoints.forEach(p => {
      const block = p.block_name || '全部知识点';
      (groups[block] = groups[block] || []).push(p);
    });
    const blocks = Object.entries(groups).map(([name, points]) => ({ name, points }));
    const replace = document.querySelector('input[name="replace-old"]:checked')?.value || 'none';
    const deleteIds = replace === 'selected'
      ? Array.from(document.querySelectorAll('.ai-select-check:checked')).map(cb => parseInt(cb.dataset.id, 10))
      : [];
    try {
      const payload = { blocks, replace_old: replace };
      if (deleteIds.length) payload.delete_card_ids = deleteIds;
      payload.speedRef = speedRef;
      payload.onProgress = (done, total) => this.updateAiProgress('ai-gen-bar', 'ai-gen-text', done, total, `${tierLabel} 档 · ${batchCount} 批`);
      const data = await API.post(`/api/zones/${zoneId}/generate`, payload);
      if (progressWrap) progressWrap.classList.add('hidden');
      const failedCount = (data.failed || []).length;
      Toast.show(
        failedCount > 0
          ? `生成 ${data.generated} 张卡片，${failedCount} 个失败`
          : `成功生成 ${data.generated} 张卡片`,
        failedCount > 0 ? 'error' : 'success'
      );
      App.navigate('zone', zoneId);
    } catch (e) {
      if (progressWrap) progressWrap.classList.add('hidden');
      chat.innerHTML += `<div class="ai-msg ai-msg-bot">生成失败：${Utils.esc(e.message)}</div>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认生成卡片';
    }
  },

  // Dedicated card list page grouped by block
  async renderCards(zoneId) {
    await Library.renderFull(zoneId);
  },

  async loadZoneDetail(zoneId) {
    try {
      const data = await API.get(`/api/zones/${zoneId}`);
      const zone = data.zone;
      const stats = data.stats;
      const files = data.files || [];

      document.getElementById('zone-name').textContent = zone.name;
      document.getElementById('zone-stats').innerHTML = `
        <div class="stat-item"><div class="stat-num">${stats.total}</div><div class="stat-label">总卡片</div></div>
        <div class="stat-item"><div class="stat-num">${stats.success}</div><div class="stat-label">已通关</div></div>
        <div class="stat-item"><div class="stat-num">${files.length}</div><div class="stat-label">文件数</div></div>
      `;
      this.renderStudyMode(zoneId, zone.study_mode || 'quiz');
      await this.loadProgress(zoneId);
      await this.renderCalendar('zone-calendar', zoneId);

      // File list
      const fileList = document.getElementById('file-list');
      fileList.innerHTML = files.map(f => `
        <div class="file-item">
          <span class="file-icon">📄</span>
          <span class="file-name">${Utils.esc(f.filename)}</span>
          <span class="file-size">${Utils.formatSize(f.size)}</span>
        </div>
      `).join('');

      // Show analyze area only if files exist
      const analyzeArea = document.getElementById('analyze-area');
      if (files.length > 0) {
        analyzeArea.classList.remove('hidden');
      } else {
        analyzeArea.classList.add('hidden');
      }

      // Load card libraries
      await Library.renderEmbedded(zoneId, document.getElementById('library-panel'));
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  renderStudyMode(zoneId, mode) {
    const row = document.getElementById('study-mode-row');
    if (!row) return;
    row.querySelectorAll('.study-mode-btn').forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.onclick = async () => {
        if (btn.dataset.mode === mode) return;
        try {
          await API.put(`/api/zones/${zoneId}/settings`, { study_mode: btn.dataset.mode });
          Toast.show('关卡学习模式已切换', 'success');
          await this.loadZoneDetail(zoneId);
        } catch (e) {
          Toast.show(e.message, 'error');
        }
      };
    });
  },

  // Upload file
  async handleUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    for (const file of files) {
      try {
        await API.upload(`/api/zones/${this.currentZoneId}/files`, file);
        Toast.show(`${file.name} 上传成功`, 'success');
      } catch (err) {
        Toast.show(err.message, 'error');
      }
    }
    e.target.value = '';
    await this.loadZoneDetail(this.currentZoneId);
  },

  // AI Analyze knowledge points
  async handleAnalyze() {
    const btn = document.getElementById('btn-analyze');
    btn.disabled = true;
    btn.textContent = '⏳ AI 分析中...';
    try {
      const data = await API.post(`/api/zones/${this.currentZoneId}/analyze`);
      const kpArea = document.getElementById('kp-area');
      const points = data.knowledge_points || [];
      if (points.length === 0) {
        kpArea.innerHTML = '<p style="color:#94a3b8">未识别到知识点，请上传更多内容</p>';
        btn.disabled = false;
        btn.textContent = '🔍 AI 分析知识点';
        return;
      }
      kpArea.innerHTML = `
        <div class="kp-list">
          ${points.map((p, i) => `
            <div class="kp-item">
              <input type="checkbox" class="kp-checkbox" checked data-index="${i}">
              <div>
                <div class="kp-text">${Utils.esc(p.title)}</div>
                <div class="kp-desc">${Utils.esc(p.description || '')}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-primary btn-sm btn-block btn-generate" id="btn-generate">⚡ 生成卡片</button>
        <div id="gen-progress" class="generate-progress hidden"></div>
      `;

      document.getElementById('btn-generate').onclick = () => this.handleGenerate(points);
      btn.disabled = false;
      btn.textContent = '🔍 AI 分析知识点';
    } catch (e) {
      Toast.show(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '🔍 AI 分析知识点';
    }
  },

  // Generate cards from selected knowledge points
  async handleGenerate(allPoints) {
    const btn = document.getElementById('btn-generate');
    const progress = document.getElementById('gen-progress');
    const checkboxes = document.querySelectorAll('.kp-checkbox:checked');
    const selected = Array.from(checkboxes).map(cb => allPoints[parseInt(cb.dataset.index)].title);

    if (selected.length === 0) {
      Toast.show('请至少选择一个知识点');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';
    progress.classList.remove('hidden');
    progress.innerHTML = `正在生成 0/${selected.length} 张卡片...`;

    try {
      // Generate in batches of 3
      let generated = 0;
      let failed = [];
      for (let i = 0; i < selected.length; i += 3) {
        const batch = selected.slice(i, i + 3);
        progress.innerHTML = `正在生成 ${generated}/${selected.length} 张卡片...`;
        try {
          const data = await API.post(`/api/zones/${this.currentZoneId}/generate`, { knowledge_points: batch });
          generated += data.generated || 0;
          if (data.failed) failed = failed.concat(data.failed);
        } catch (e) {
          Toast.show(`批次生成失败: ${e.message}`, 'error');
        }
      }

      progress.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = '⚡ 生成卡片';

      if (failed.length > 0) {
        Toast.show(`生成了 ${generated} 张卡片，${failed.length} 个失败`, 'error');
      } else {
        Toast.show(`成功生成 ${generated} 张卡片！`, 'success');
      }
      await this.loadCards(this.currentZoneId);
      await this.loadZoneDetail(this.currentZoneId);
    } catch (e) {
      Toast.show(e.message, 'error');
      progress.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = '⚡ 生成卡片';
    }
  },

  // Load card list
  async loadCards(zoneId) {
    try {
      const data = await API.get(`/api/zones/${zoneId}/cards`);
      const cards = data.cards || [];
      const cardList = document.getElementById('card-list');
      const cardEmpty = document.getElementById('card-empty');
      const btnCards = document.getElementById('btn-cards');
      const btnWrong = document.getElementById('btn-wrong');

      if (cards.length === 0) {
        cardList.innerHTML = '';
        cardEmpty.classList.remove('hidden');
        btnCards.style.display = 'none';
        btnWrong.style.display = 'none';
      } else {
        cardEmpty.classList.add('hidden');
        cardList.innerHTML = cards.map(c => `
          <div class="card-item">
            <span class="card-item-badge ${c.status === '成功' ? 'badge-success' : c.status === '重点复习' ? 'badge-review' : 'badge-todo'}">${c.status}</span>
            <span class="card-item-title">${Utils.esc(c.title)}</span>
            <span style="font-size:0.7rem;color:#94a3b8">${Utils.esc(c.label)}</span>
          </div>
        `).join('');
        btnCards.style.display = 'inline-flex';
        btnWrong.style.display = 'inline-flex';
      }
    } catch (e) {
      // silently ignore
    }
  },

  // Level progress, check-in, review and per-zone daily limit
  askRebuildMode(zoneId, body) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal');
      const box = document.getElementById('modal-box');
      box.innerHTML = `
        <h3>选择关卡处理方式</h3>
        <p style="font-size:0.9rem;color:#64748b;margin-bottom:12px;">修改排序或每日卡片数会生成新的关卡布局，请选择处理方式。</p>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-outline btn-sm" id="modal-new-levels">新建后续关卡</button>
          <button class="btn btn-primary btn-sm" id="modal-overwrite-levels">覆盖原有关卡</button>
        </div>
      `;
      modal.classList.remove('hidden');
      document.getElementById('modal-new-levels').onclick = async () => {
        modal.classList.add('hidden');
        try {
          await API.put(`/api/zones/${zoneId}/settings`, { ...body, rebuild_mode: 'new' });
          Toast.show('已新建后续关卡', 'success');
          resolve(true);
        } catch (e) {
          Toast.show(e.message, 'error');
          resolve(false);
        }
      };
      document.getElementById('modal-overwrite-levels').onclick = async () => {
        modal.classList.add('hidden');
        try {
          await API.put(`/api/zones/${zoneId}/settings`, { ...body, rebuild_mode: 'overwrite' });
          Toast.show('已覆盖原有关卡', 'success');
          resolve(true);
        } catch (e) {
          Toast.show(e.message, 'error');
          resolve(false);
        }
      };
    });
  },

  async loadProgress(zoneId) {
    try {
      const p = await API.get(`/api/zones/${zoneId}/progress`);
      const el = document.getElementById('zone-progress');
      const pct = p.total_cards > 0 ? Math.round((p.done_cards / p.total_cards) * 100) : 0;
      const weekHtml = (p.week || []).map(w => `<span class="week-dot ${w.checked ? 'checked' : ''}" title="${w.date}"></span>`).join('');
      const levels = p.levels || [];
      const sortMode = p.sort_mode || 'easy_to_hard';
      const layout = p.layout || { lower: 0, upper: 0, recommended: 0, selected: null };
      const hasLayout = p.total_cards > 0 && layout.upper > 0;

      // --- Project management ---
      let projects = this._loadProjects(zoneId);
      if (!projects.length && levels.length) {
        // Auto-create default project from all existing levels
        const defaultName = '关卡项目 1';
        const pStart = levels[0] ? levels[0].level_no : 1;
        const pEnd = levels[levels.length - 1] ? levels[levels.length - 1].level_no : pStart;
        projects = [{ name: defaultName, level_start: pStart, level_end: pEnd, id: 'p1' }];
        this._saveProjects(zoneId, projects);
      }
      let activeProj = projects.length ? projects[0] : null;
      const activeProjId = this._activeProjectId || (activeProj ? activeProj.id : null);
      if (activeProjId) {
        const found = projects.find((pr) => pr.id === activeProjId);
        if (found) activeProj = found;
      }

      // --- Filter levels for active project ---
      const projLevels = activeProj
        ? levels.filter((lv) => lv.level_no >= activeProj.level_start && lv.level_no <= activeProj.level_end)
        : levels;

      // --- Build Duolingo path for active project ---
      const cols = 5;
      const items = [];
      let prevBlock = null;
      projLevels.forEach((lv) => {
        const block = sortMode === 'block' ? (lv.block_name || lv.name || '') : '';
        if (sortMode === 'block' && prevBlock !== null && block !== prevBlock) { items.push({ type: 'divider', block }); }
        items.push({ type: 'level', lv });
        prevBlock = block;
      });
      const pathRows = [];
      let currentRow = [];
      const flushRow = () => {
        if (!currentRow.length) return;
        const reversed = pathRows.length % 2 === 1;
        pathRows.push(`<div class="path-row ${reversed ? 'reverse' : ''}">${currentRow.map((lv) => this.nodeHtml(lv, p.current_level)).join('')}</div>`);
        currentRow = [];
      };
      items.forEach((item) => {
        if (item.type === 'divider') { flushRow(); pathRows.push(`<div class="path-block-divider"><span>${Utils.esc(item.block)}</span></div>`); }
        else { currentRow.push(item.lv); if (currentRow.length >= cols) flushRow(); }
      });
      flushRow();
      const pathHtml = pathRows.join('');

      const projStats = activeProj ? { done: projLevels.filter((lv) => lv.status === '已通关').length, total: projLevels.length,
        current: projLevels.find((lv) => lv.level_no === p.current_level) ? p.current_level : (projLevels[0] ? projLevels[0].level_no : 0) } : { done: 0, total: 0, current: 0 };

      const newProgress = p.today_new_total > 0 ? `${p.today_new_done}/${p.today_new_total}` : '—';

      // --- Render: left tabs + right path ---
      el.innerHTML = `
        <div class="level-card">
          <div class="level-head">
            <span class="level-title">${Utils.esc(activeProj ? activeProj.name : '全部关卡')} · 已通关 ${projStats.done}/${projStats.total}</span>
            <span class="streak">🔥 ${p.streak} 天</span>
          </div>
          <div class="level-bar-bg"><div class="level-bar-fill" style="width:${pct}%"></div></div>
          <div class="level-meta">
            <span>卡片 ${p.done_cards}/${p.total_cards}</span>
            <span>今日新卡 ${newProgress}</span>
            <span>待复习 ${p.review_today || 0}</span>
          </div>
          <div class="week-row">${weekHtml}</div>
          <div style="display:flex;gap:12px;margin-top:12px;border-top:1px solid #f1f5f9;padding-top:10px">
            <!-- Left: project tabs -->
            <div style="width:140px;flex-shrink:0;display:flex;flex-direction:column;gap:4px" id="project-tabs">
              ${projects.map((pr) => {
                const prLvls = levels.filter((lv) => lv.level_no >= pr.level_start && lv.level_no <= pr.level_end);
                const prDone = prLvls.filter((lv) => lv.status === '已通关').length;
                const isActive = activeProj && pr.id === activeProj.id;
                return `<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}" data-proj-id="${pr.id}" style="text-align:left;justify-content:flex-start;height:auto;padding:8px 10px;font-size:13px" title="${Utils.esc(pr.name)}">${Utils.esc(pr.name)}<span style="margin-left:auto;font-size:10px;opacity:0.7">${prDone}/${prLvls.length}</span></button>`;
              }).join('')}
              <button class="btn btn-outline btn-sm" id="btn-new-project" style="margin-top:4px;font-size:12px">+ 新建</button>
            </div>
            <!-- Right: Duolingo path -->
            <div style="flex:1;min-width:0">
              <div class="level-path-wrap">
                <svg class="path-svg"></svg>
                <div class="path-rows">${pathHtml}</div>
              </div>
            </div>
          </div>
          <div class="sort-mode-row" style="margin-top:10px">
            <label>学习排序</label>
            <div class="sort-mode-control">
              <button class="sort-mode-btn ${sortMode === 'easy_to_hard' ? 'active' : ''}" data-mode="easy_to_hard">由易到难</button>
              <button class="sort-mode-btn ${sortMode === 'block' ? 'active' : ''}" data-mode="block">区块学习</button>
            </div>
          </div>
          ${hasLayout ? `
            <div class="layout-row">
              <label for="zone-level-count">关卡数量</label>
              <input type="number" id="zone-level-count" min="${layout.lower}" max="${layout.upper}" value="${layout.selected || layout.recommended || ''}" placeholder="${layout.recommended}">
              <button class="btn btn-primary btn-sm" id="btn-save-level-count">保存</button>
            </div>
            <div class="layout-hint">AI 建议 ${layout.recommended} 关，可选 ${layout.lower} - ${layout.upper}</div>
          ` : ''}
          <div class="daily-limit-row">
            <label for="zone-daily-limit">每日卡片数</label>
            <input type="number" id="zone-daily-limit" min="1" max="100" value="${p.daily_limit}">
            <button class="btn btn-outline btn-sm" id="btn-save-zone-limit">保存</button>
          </div>
        </div>
      `;

      this.drawPath(el);

      // --- Bind events ---
      el.querySelectorAll('.level-node-wrap:not(.locked)').forEach((node) => {
        node.addEventListener('click', () => { App.navigate('level', zoneId, parseInt(node.dataset.level, 10)); });
      });

      // Project tab switching
      el.querySelectorAll('[data-proj-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._activeProjectId = btn.dataset.projId;
          this.loadProgress(zoneId);
        });
      });

      // New project button
      const newProjBtn = document.getElementById('btn-new-project');
      if (newProjBtn) {
        newProjBtn.onclick = () => this._createProject(zoneId, projects, levels);
      }

      // Sort mode change
      el.querySelectorAll('.sort-mode-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const mode = btn.dataset.mode;
          if (mode === p.sort_mode) return;
          const ok = await this.askRebuildMode(zoneId, { sort_mode: mode });
          if (ok) await this.loadProgress(zoneId);
        });
      });

      // Daily limit change
      const saveLimitBtn = document.getElementById('btn-save-zone-limit');
      if (saveLimitBtn) {
        saveLimitBtn.onclick = async () => {
          const limit = parseInt(document.getElementById('zone-daily-limit').value, 10);
          if (!limit || limit < 1 || limit > 100) { Toast.show('请输入 1-100 的卡片数', 'error'); return; }
          const ok = await this.askRebuildMode(zoneId, { daily_card_limit: limit });
          if (ok) await this.loadProgress(zoneId);
        };
      }

      // Level count change
      if (hasLayout) {
        const saveCountBtn = document.getElementById('btn-save-level-count');
        if (saveCountBtn) {
          saveCountBtn.onclick = async () => {
            const n = parseInt(document.getElementById('zone-level-count').value, 10);
            if (!n || n < layout.lower || n > layout.upper) { Toast.show(`关卡数需在 ${layout.lower} 到 ${layout.upper} 之间`, 'error'); return; }
            try {
              await API.put(`/api/zones/${zoneId}/levels/layout`, { level_count: n });
              Toast.show('关卡排版已更新', 'success');
              await this.loadProgress(zoneId);
            } catch (e) { Toast.show(e.message, 'error'); }
          };
        }
      }
    } catch (e) { /* progress is optional */ }
  },

  // --- Project helpers ---
  _loadProjects(zoneId) {
    try { return JSON.parse(localStorage.getItem('ai-projects-' + zoneId) || '[]'); } catch (e) { return []; }
  },
  _saveProjects(zoneId, projects) {
    try { localStorage.setItem('ai-projects-' + zoneId, JSON.stringify(projects)); } catch (e) {}
  },
  _createProject(zoneId, projects, levels) {
    const idx = projects.length + 1;
    const defaultName = `关卡项目 ${idx}`;
    // New project starts after the last level of the last project
    const lastEnd = projects.length ? Math.max(...projects.map((p) => p.level_end)) : (levels.length ? levels[levels.length - 1].level_no : 0);
    const newStart = lastEnd + 1;
    const newEnd = newStart; // initially empty, user can add levels via settings changes
    const newProj = { id: 'p' + Date.now(), name: defaultName, level_start: newStart, level_end: newEnd };
    projects.push(newProj);
    this._saveProjects(zoneId, projects);
    // Prompt user to customize name
    const name = prompt('请输入项目名称：', defaultName);
    if (name !== null && name.trim()) {
      newProj.name = name.trim();
      this._saveProjects(zoneId, projects);
    }
    this._activeProjectId = newProj.id;
    this.loadProgress(zoneId);
  },

  nodeHtml(lv, currentLevel) {
    const state = lv.status === '已通关'
      ? 'done'
      : lv.level_no === currentLevel
        ? 'current'
        : (lv.level_type === '复习' && lv.due_reviews > 0 ? 'review-due' : 'locked');
    const icon = state === 'done' ? '✓' : state === 'current' ? lv.level_no : state === 'review-due' ? '★' : '🔒';
    const levelName = lv.name || `第${lv.level_no}关`;
    const reviewHint = lv.due_reviews > 0 ? ` · 待复习 ${lv.due_reviews} 张` : (lv.next_review ? ` · 复习 ${lv.next_review}` : '');
    return `
      <div class="level-node-wrap ${state}" data-level="${lv.level_no}" title="${Utils.esc(levelName)} · ${Utils.esc(lv.level_type)} · ${lv.done_cards}/${lv.card_count}张${reviewHint}">
        <div class="level-node">${icon}</div>
        <span class="node-badge ${lv.level_type === '新学' ? 'node-badge-new' : 'node-badge-review'}">${lv.level_type === '新学' ? '新' : '复习'}</span>
        ${lv.due_reviews > 0 ? '<span class="due-dot"></span>' : ''}
      </div>
    `;
  },

  drawPath(el) {
    const wrap = el.querySelector('.level-path-wrap');
    const svg = wrap && wrap.querySelector('.path-svg');
    if (!wrap || !svg) return;
    const nodes = wrap.querySelectorAll('.level-node-wrap');
    if (nodes.length < 2) {
      svg.removeAttribute('viewBox');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const pts = [];
    nodes.forEach(n => {
      const r = n.getBoundingClientRect();
      pts.push([r.left + r.width / 2 - wrapRect.left, r.top + r.height / 2 - wrapRect.top]);
    });
    const w = wrap.scrollWidth || wrapRect.width;
    const h = wrap.scrollHeight || wrapRect.height;
    svg.setAttribute('viewBox', `0 0 ${Math.ceil(w)} ${Math.ceil(h)}`);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    svg.innerHTML = `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
};
