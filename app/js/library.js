// Library module - three card libraries with search, favorites and hamburger menu
const Library = {
  currentZoneId: null,
  tab: 'quiz',
  query: '',
  selectionMode: false,
  selectionAction: null,
  selected: new Set(),

  async renderEmbedded(zoneId, container) {
    this.currentZoneId = zoneId;
    this.tab = 'quiz';
    this.query = '';
    this.selectionMode = false;
    this.selected = new Set();
    await this.mount(zoneId, container);
  },

  async renderFull(zoneId) {
    this.currentZoneId = zoneId;
    this.tab = 'quiz';
    this.query = '';
    this.selectionMode = false;
    this.selected = new Set();
    const tpl = document.getElementById('tpl-cards');
    App.setPage(tpl);
    document.getElementById('btn-back-cards').onclick = () => App.navigate('zone', zoneId);
    await this.mount(zoneId, document.getElementById('library-full'));
  },

  async mount(zoneId, container) {
    container.innerHTML = `
      <div class="library-tabs">
        <button class="library-tab active" data-tab="quiz">闯关卡库</button>
        <button class="library-tab" data-tab="memory">记忆卡库</button>
        <button class="library-tab" data-tab="favorites">收藏库</button>
      </div>
      <div class="library-toolbar">
        <input class="library-search" type="search" placeholder="搜索关键词" value="">
        <button class="library-menu-btn" title="库菜单">☰</button>
      </div>
      <div class="library-list"></div>
      <div class="library-empty hidden">
        <div class="empty-icon">🃏</div>
        <p>这个库还没有卡片</p>
      </div>
      <div class="library-action-bar hidden">
        <button class="btn btn-outline btn-sm" id="btn-library-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="btn-library-action">执行</button>
      </div>
    `;
    container.querySelectorAll('.library-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.selectionMode = false;
        this.selected = new Set();
        container.querySelectorAll('.library-tab').forEach((b) => b.classList.toggle('active', b === btn));
        this.load(zoneId, container);
      });
    });
    const search = container.querySelector('.library-search');
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.query = search.value.trim();
        this.load(zoneId, container);
      }, 250);
    });
    container.querySelector('.library-menu-btn').addEventListener('click', () => {
      if (this.selectionMode) {
        this.selectionMode = false;
        this.selectionAction = null;
        this.selected = new Set();
        this.load(zoneId, container);
      } else {
        this.showMenu(zoneId, container);
      }
    });
    await this.load(zoneId, container);
  },

  async load(zoneId, container) {
    const listEl = container.querySelector('.library-list');
    const emptyEl = container.querySelector('.library-empty');
    const actionBar = container.querySelector('.library-action-bar');
    try {
      const data = await API.get(
        `/api/zones/${zoneId}/library?kind=${encodeURIComponent(this.tab)}&q=${encodeURIComponent(this.query)}`
      );
      const cards = data.cards || [];
      if (!cards.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        if (actionBar) actionBar.classList.add('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      if (actionBar) actionBar.classList.toggle('hidden', !this.selectionMode);
      if (this.tab === 'favorites') {
        const quizCards = cards.filter((c) => c.kind !== 'memory');
        const memoryCards = cards.filter((c) => c.kind === 'memory');
        listEl.innerHTML = `
          <div class="library-columns">
            <div class="library-col">
              <div class="library-col-title">闯关卡区</div>
              ${quizCards.length ? quizCards.map((c) => this.cardHtml(c)).join('') : '<div class="ai-select-empty">暂无收藏闯关卡</div>'}
            </div>
            <div class="library-col">
              <div class="library-col-title">知识卡区</div>
              ${memoryCards.length ? memoryCards.map((c) => this.cardHtml(c)).join('') : '<div class="ai-select-empty">暂无收藏知识卡</div>'}
            </div>
          </div>
        `;
      } else {
        listEl.innerHTML = cards.map((c) => this.cardHtml(c)).join('');
      }
      this.bindList(zoneId, container, cards);
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state"><p>${Utils.esc(e.message)}</p></div>`;
      if (emptyEl) emptyEl.classList.add('hidden');
    }
  },

  cardHtml(c) {
    const statusClass = c.status === '成功' ? 'status-done' : c.status === '重点复习' ? 'badge-review' : 'badge-todo';
    const favClass = c.favorite ? 'fav-on' : '';
    const pathText = c.path || c.block_name || '未分区';
    const kindTag = c.kind === 'memory' ? '记忆' : '闯关';
    const checkbox = this.selectionMode
      ? `<input type="checkbox" class="library-check" data-id="${Utils.esc(String(c.id))}" data-kind="${c.kind}" ${this.selected.has(String(c.id)) ? 'checked' : ''}>`
      : '';
    let body;
    if (c.kind === 'memory') {
      body = `
        <div class="library-item-title">${Utils.esc(c.title)}</div>
        <div class="library-item-detail">${Utils.esc(c.back_detail || '')}</div>
        <div class="library-item-meta">${Utils.esc(c.difficulty || '中')} · ${Utils.esc(pathText)}</div>
      `;
    } else {
      body = `
        <div class="library-item-title">${Utils.esc(c.title)}</div>
        <div class="library-item-detail">${Utils.esc(c.question || '')}</div>
        <div class="library-item-meta">${Utils.esc(c.label || '常考')} · 正确答案 ${Utils.esc(c.answer || '')} · ${Utils.esc(pathText)}</div>
      `;
    }
    return `
      <div class="library-item" draggable="true" data-id="${Utils.esc(String(c.id))}" data-kind="${c.kind}">
        ${checkbox}
        <span class="drag-handle" title="拖动排序">⋮⋮</span>
        <div class="library-item-body">
          <div class="library-item-head">
            <span class="library-kind" data-kind="${c.kind}">${kindTag}</span>
            <span class="library-status ${statusClass}">${Utils.esc(c.status || '待学')}</span>
            <span class="library-difficulty diff-${({ 易: 'easy', 中: 'mid', 难: 'hard' })[c.difficulty] || 'mid'}">${Utils.esc(c.difficulty || '中')}</span>
            <button class="library-fav ${favClass}" data-id="${Utils.esc(String(c.id))}" data-kind="${c.kind}" title="收藏">${c.favorite ? '★' : '☆'}</button>
          </div>
          ${body}
        </div>
      </div>
    `;
  },

  bindList(zoneId, container, cards) {
    const listEl = container.querySelector('.library-list');
    listEl.querySelectorAll('.library-item[draggable]').forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.dataset.id);
        e.dataTransfer.setData('kind', item.dataset.kind);
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        const kind = e.dataTransfer.getData('kind') || item.dataset.kind;
        if (!draggedId || kind !== item.dataset.kind) return;
        const section = item.parentElement;
        if (!section || !section.classList.contains('library-col')) return;
        const ids = Array.from(section.querySelectorAll('.library-item')).map((el) => el.dataset.id);
        const fromIndex = ids.indexOf(draggedId);
        const toIndex = ids.indexOf(item.dataset.id);
        if (fromIndex < 0 || toIndex < 0) return;
        ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, draggedId);
        try {
          await API.post('/api/cards/reorder', {
            zone_id: zoneId,
            kind,
            card_ids: ids
          });
          await this.load(zoneId, container);
        } catch (err) {
          Toast.show(err.message, 'error');
        }
      });
    });
    listEl.querySelectorAll('.library-fav').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.post('/api/cards/toggle-favorite', {
            zone_id: zoneId,
            kind: btn.dataset.kind,
            card_id: btn.dataset.id
          });
          await this.load(zoneId, container);
        } catch (e) {
          Toast.show(e.message, 'error');
        }
      });
    });
    if (!this.selectionMode) return;
    const actionBtn = container.querySelector('#btn-library-action');
    listEl.querySelectorAll('.library-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) this.selected.add(id);
        else this.selected.delete(id);
      });
    });
    actionBtn.textContent = this.selectionAction === 'delete' ? '删除选中' : '学习选中';
    container.querySelector('#btn-library-cancel').onclick = () => {
      this.selectionMode = false;
      this.selected = new Set();
      this.load(zoneId, container);
    };
    actionBtn.onclick = async () => {
      const picked = cards.filter((c) => this.selected.has(String(c.id)));
      if (!picked.length) {
        Toast.show('请先勾选卡片');
        return;
      }
      if (this.selectionAction === 'delete') {
        this.confirmDelete(zoneId, container, picked);
      } else {
        this.startStudy(zoneId, picked);
      }
    };
  },

  showMenu(zoneId, container) {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3>库菜单</h3>
      <div class="menu-group">
        <div class="menu-label">筛选模式</div>
        <button class="btn btn-outline btn-sm btn-block" id="menu-sort-easy">以难易程度排序</button>
        <button class="btn btn-outline btn-sm btn-block" id="menu-sort-block">以知识块结构排序</button>
      </div>
      <div class="menu-group">
        <button class="btn btn-outline btn-sm btn-block" id="menu-delete">删除卡片</button>
        <button class="btn btn-primary btn-sm btn-block" id="menu-study">选择学习</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">关闭</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.getElementById('menu-sort-easy').onclick = async () => {
      modal.classList.add('hidden');
      try {
        await API.put(`/api/zones/${zoneId}/settings`, { sort_mode: 'easy_to_hard' });
        await this.load(zoneId, container);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    document.getElementById('menu-sort-block').onclick = async () => {
      modal.classList.add('hidden');
      try {
        await API.put(`/api/zones/${zoneId}/settings`, { sort_mode: 'block' });
        await this.load(zoneId, container);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    document.getElementById('menu-delete').onclick = () => {
      modal.classList.add('hidden');
      this.selectionMode = true;
      this.selectionAction = 'delete';
      this.selected = new Set();
      this.load(zoneId, container);
    };
    document.getElementById('menu-study').onclick = () => {
      modal.classList.add('hidden');
      this.selectionMode = true;
      this.selectionAction = 'study';
      this.selected = new Set();
      this.load(zoneId, container);
    };
  },

  confirmDelete(zoneId, container, picked) {
    const modal = document.getElementById('modal');
    const box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3>确认删除</h3>
      <p style="font-size:0.9rem;color:#64748b;margin-bottom:12px;">将删除选中的 ${picked.length} 张卡片，相关记录会一并清理。</p>
      <label class="library-pair-option"><input type="checkbox" id="delete-with-pair"> 同时删除对应的另一张卡</label>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="modal-cancel">取消</button>
        <button class="btn btn-danger btn-sm" id="modal-confirm">确认删除</button>
      </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      const withPair = !!document.getElementById('delete-with-pair').checked;
      modal.classList.add('hidden');
      const groups = {};
      picked.forEach((c) => {
        (groups[c.kind] = groups[c.kind] || []).push(c.id);
      });
      try {
        let deleted = 0;
        for (const [kind, ids] of Object.entries(groups)) {
          const res = await API.post('/api/cards/delete', {
            zone_id: zoneId,
            kind,
            card_ids: ids,
            with_pair: withPair
          });
          deleted += res.deleted || 0;
        }
        Toast.show(`已删除 ${deleted} 张卡片`, 'success');
        this.selectionMode = false;
        this.selected = new Set();
        await this.load(zoneId, container);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
  },

  startStudy(zoneId, picked) {
    const groups = {};
    picked.forEach((c) => {
      (groups[c.kind] = groups[c.kind] || []).push(c.id);
    });
    const queue = Object.entries(groups);
    this.selectionMode = false;
    this.selected = new Set();
    const runNext = () => {
      const next = queue.shift();
      if (next) {
        Cards.renderSelectedPractice(zoneId, next[0], next[1], runNext);
      } else {
        App.navigate('zone', zoneId);
      }
    };
    runNext();
  }
};
