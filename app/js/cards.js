// Cards module - daily quiz / answer flow
const Cards = {
  currentZoneId: null,
  cards: [],
  progress: null,
  currentIndex: 0,
  totalCount: 0,
  completed: 0,
  answered: false,
  lock: false,
  mode: 'daily',
  levelNo: null,
  kind: 'quiz',
  onDone: null,
  wrongKind: 'quiz',

  async refreshProgressAndNavigate(route, zoneId, ...args) {
    try {
      await API.get(`/api/zones/${zoneId}/progress`);
    } catch (e) {
      // progress refresh is best-effort
    }
    App.navigate(route, zoneId, ...args);
  },

  // Render a specific level from the Duolingo-style path
  async renderLevel(zoneId, levelNo) {
    this.currentZoneId = zoneId;
    this.levelNo = levelNo;
    this.cards = [];
    this.progress = null;
    this.currentIndex = 0;
    this.completed = 0;
    this.answered = false;
    this.lock = false;
    const tpl = document.getElementById('tpl-learn');
    App.setPage(tpl);

    document.getElementById('btn-back-zone').onclick = () => App.navigate('zone', zoneId);

    try {
      const data = await API.get(`/api/zones/${zoneId}/levels/${levelNo}/start`);
      this.mode = data.mode;
      this.kind = data.kind || 'quiz';
      this.cards = data.cards || [];
      this.totalCount = data.total_count || this.cards.length;
      this.completed = data.done_count || 0;
      const levelType = data.level && data.level.level_type;
      const suffix = this.mode === 'replay' ? ' · 重练' : (levelType === '复习' ? ' · 复习' : ' · 新学');
      document.getElementById('learn-title').textContent = `第 ${levelNo} 关${suffix}`;

      if (this.cards.length === 0) {
        this.renderDone(data);
        return;
      }

      this.renderProgress();
      if (this.kind === 'memory') this.renderMemoryCard(0);
      else this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  // Render the daily quiz page
  async renderLearn(zoneId) {
    this.currentZoneId = zoneId;
    this.levelNo = null;
    this.mode = 'daily';
    this.cards = [];
    this.progress = null;
    this.currentIndex = 0;
    this.completed = 0;
    this.answered = false;
    this.lock = false;
    const tpl = document.getElementById('tpl-learn');
    App.setPage(tpl);
    
    document.getElementById('btn-back-zone').onclick = () => App.navigate('zone', zoneId);
    
    try {
      const [data, progress] = await Promise.all([
        API.get(`/api/zones/${zoneId}/today`),
        API.get(`/api/zones/${zoneId}/progress`)
      ]);
      this.progress = progress;
      this.totalCount = data.total_count || (data.pending || []).length;
      this.completed = data.done_count || 0;
      this.cards = data.pending || [];
      this.levelNo = data.level_no || null;
      this.kind = data.kind || 'quiz';
      document.getElementById('learn-title').textContent = `第 ${progress.current_level} 关 · ${data.level_type === '复习' ? '复习' : '新学'} (每日 ${data.daily_limit} 张)`;
      
      if (data.completed || this.cards.length === 0) {
        this.renderDone(data);
        return;
      }

      this.renderProgress();
      if (this.kind === 'memory') this.renderMemoryCard(0);
      else this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  // Render standalone wrong-card practice
  async renderWrongPractice(zoneId) {
    this.currentZoneId = zoneId;
    this.levelNo = null;
    this.mode = 'wrong';
    this.kind = this.wrongKind || 'quiz';
    this.cards = [];
    this.progress = null;
    this.currentIndex = 0;
    this.completed = 0;
    this.answered = false;
    this.lock = false;
    const tpl = document.getElementById('tpl-learn');
    App.setPage(tpl);

    document.getElementById('btn-back-zone').onclick = () => App.navigate('zone', zoneId);

    try {
      const data = await API.get(`/api/zones/${zoneId}/wrong-practice?kind=${this.kind}`);
      this.cards = data.cards || [];
      this.totalCount = this.cards.length;
      document.getElementById('learn-title').textContent = this.kind === 'memory'
        ? `记忆错题复习 (${this.totalCount} 张)`
        : `错题复习 (${this.totalCount} 道)`;

      if (this.cards.length === 0) {
        this.renderDone(data);
        return;
      }

      this.renderProgress();
      if (this.kind === 'memory') this.renderMemoryCard(0);
      else this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  renderProgress() {
    const done = this.completed;
    const total = this.totalCount;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const label = this.mode === 'replay'
      ? '本关任务'
      : this.mode === 'wrong'
        ? (this.kind === 'memory' ? '记忆练习' : '错题练习')
        : (this.kind === 'memory' ? '记忆学习' : '今日任务');
    document.getElementById('learn-progress').innerHTML = `
      <div class="progress-text">${label} ${done}/${total} (已完成 ${pct}%)</div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    `;
  },

  renderCard(index) {
    if (index >= this.cards.length) {
      this.renderDone();
      return;
    }

    this.currentIndex = index;
    this.answered = false;
    this.lock = false;

    const card = this.cards[index];
    const labelMap = { '必考': 'label-bikao', '常考': 'label-changkao', '加分': 'label-jiafen' };
    const labelClass = labelMap[card.label] || 'label-changkao';
    const reviewLabel = card.review_mode === 'wrong' ? '错题强化' : card.review_mode === 'correct' ? '间隔复习' : '新学';
    const letters = ['A', 'B', 'C', 'D'];

    const quizEl = document.getElementById('card-quiz');
    quizEl.innerHTML = `
      <div class="card-quiz">
        <span class="quiz-mode">${reviewLabel}</span>
        <span class="quiz-label ${labelClass}">${Utils.esc(card.label)}</span>
        <h4 style="font-size:0.8rem;color:#94a3b8;margin-bottom:4px;">${Utils.esc(card.title)}</h4>
        <div class="quiz-question">${Utils.esc(card.question)}</div>
        <div class="quiz-options" id="quiz-options">
          ${letters.map((l, i) => `
            <div class="quiz-option" data-letter="${l}">
              <span class="option-letter">${l}</span>
              <span>${Utils.esc(card.options[l] || '')}</span>
            </div>
          `).join('')}
        </div>
        <div class="quiz-result" id="quiz-result"></div>
        <button class="btn btn-primary btn-block btn-next" id="btn-next">下一题 →</button>
      </div>
    `;

    const optionsEl = document.getElementById('quiz-options');
    const resultEl = document.getElementById('quiz-result');
    const nextBtn = document.getElementById('btn-next');
    const optionEls = optionsEl.querySelectorAll('.quiz-option');

    // Keyboard shortcut map: 1→A, 2→B, 3→C, 4→D, also A→A, B→B, etc.
    const keyHandler = (e) => {
      if (this.lock) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          nextBtn.click();
        }
        return;
      }
      const key = e.key.toUpperCase();
      const keyMap = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D' };
      const letter = keyMap[key];
      if (letter) {
        e.preventDefault();
        const target = optionsEl.querySelector(`.quiz-option[data-letter="${letter}"]`);
        if (target) target.click();
      }
    };
    document.addEventListener('keydown', keyHandler);
    this._keyHandler = keyHandler;

    // Click option
    optionEls.forEach((opt, i) => {
      opt.setAttribute('role', 'button');
      opt.setAttribute('tabindex', '0');
      opt.setAttribute('aria-label', `选项 ${['A','B','C','D'][i]}：${card.options[['A','B','C','D'][i]] || ''}`);
      opt.addEventListener('click', () => {
        if (this.lock) return;
        this.lock = true;
        const letter = opt.dataset.letter;
        optionsEl.querySelectorAll('.quiz-option').forEach(o => o.classList.add('disabled'));
        opt.classList.add('selected');
        document.removeEventListener('keydown', keyHandler);
        this.submitAnswer(card.card_id, letter, opt, optionsEl, resultEl, nextBtn);
      });
      // Keyboard: Enter/Space on focused option
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          opt.click();
        }
      });
    });

    nextBtn.addEventListener('click', () => {
      document.removeEventListener('keydown', this._keyHandler);
      this.renderCard(index + 1);
      this.renderProgress();
    });
    nextBtn.setAttribute('aria-label', '下一题');
  },

  async submitAnswer(cardId, letter, optEl, optionsEl, resultEl, nextBtn) {
    const card = this.cards[this.currentIndex];
    const correctLetter = this.cards[this.currentIndex].answer;
    const isCorrect = letter === correctLetter;

    // Show visual feedback
    optEl.classList.add(isCorrect ? 'correct' : 'wrong');
    if (!isCorrect) {
      // Show correct answer
      optionsEl.querySelectorAll('.quiz-option').forEach(o => {
        if (o.dataset.letter === correctLetter) o.classList.add('correct');
      });
    }

    try {
      const data = await API.post(`/api/cards/${cardId}/answer`, {
        option: letter,
        mode: this.mode,
        level_no: this.levelNo
      });
      
      resultEl.className = 'quiz-result show ' + (isCorrect ? 'correct-result' : 'wrong-result');
      resultEl.innerHTML = `
        <div class="result-text">
          <span class="result-icon">${isCorrect ? '✅' : '❌'}</span>
          ${isCorrect ? '回答正确！' : '回答错误'}
          <span style="font-size:0.8rem;color:#94a3b8;">正确答案：${data.answer}</span>
        </div>
        <div class="result-explanation">${Utils.esc(data.explanation)}</div>
      `;
      
      nextBtn.classList.add('show');
      if (isCorrect) {
        this.completed++;
      } else if (data.next_options) {
        const updated = { ...card, options: data.next_options, answer: data.next_answer };
        const dupIndex = this.cards.findIndex((c, i) => i > this.currentIndex && c.card_id === cardId);
        if (dupIndex !== -1) {
          this.cards[dupIndex] = updated;
        } else {
          this.cards.push(updated);
        }
      }
      this.renderProgress();
    } catch (e) {
      // Allow retry on error
      this.lock = false;
      optionsEl.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('disabled', 'selected'));
      Toast.show(e.message, 'error');
    }
  },

  async renderSelectedPractice(zoneId, kind, cardIds, onDone) {
    this.currentZoneId = zoneId;
    this.levelNo = null;
    this.mode = 'wrong';
    this.kind = kind === 'memory' ? 'memory' : 'quiz';
    this.cards = [];
    this.progress = null;
    this.currentIndex = 0;
    this.completed = 0;
    this.answered = false;
    this.lock = false;
    this.onDone = onDone || null;
    const tpl = document.getElementById('tpl-learn');
    App.setPage(tpl);

    document.getElementById('btn-back-zone').onclick = () => App.navigate('zone', zoneId);

    try {
      const data = await API.post('/api/cards/study', {
        zone_id: zoneId,
        kind: this.kind,
        card_ids: cardIds
      });
      this.cards = data.cards || [];
      this.totalCount = this.cards.length;
      document.getElementById('learn-title').textContent = this.kind === 'memory'
        ? `记忆卡学习 (${this.totalCount} 张)`
        : `闯关练习 (${this.totalCount} 道)`;

      if (this.cards.length === 0) {
        this.renderDone();
        return;
      }

      this.renderProgress();
      if (this.kind === 'memory') this.renderMemoryCard(0);
      else this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  renderMemoryCard(index) {
    if (index >= this.cards.length) {
      this.renderDone();
      return;
    }

    this.currentIndex = index;
    this.answered = false;
    this.lock = false;

    const card = this.cards[index];
    const reviewLabel = card.review_mode === 'wrong' ? '错题强化' : card.review_mode === 'correct' ? '间隔复习' : '新学';
    const quizEl = document.getElementById('card-quiz');
    quizEl.innerHTML = `
      <div class="memory-card">
        <span class="quiz-mode">${reviewLabel}</span>
        <span class="quiz-label label-changkao">记忆卡</span>
        <div class="memory-front">${Utils.esc(card.title)}</div>
        ${card.learning_hint ? `<div class="memory-front-hint">${Utils.esc(card.learning_hint)}</div>` : ''}
        <button class="btn btn-primary btn-block" id="btn-memory-reveal">显示背面</button>
        <div class="memory-back hidden" id="memory-back">
          <div class="memory-back-detail">${Utils.esc(card.back_detail || '')}</div>
          ${card.source_ref ? `<div class="memory-meta">出处：${Utils.esc(card.source_ref)}</div>` : ''}
          ${card.path ? `<div class="memory-meta">路径：${Utils.esc(card.path)}</div>` : ''}
          <div class="memory-actions">
            <button class="btn btn-success btn-block" data-known="1">认识</button>
            <button class="btn btn-danger btn-block" data-known="0">不认识</button>
          </div>
        </div>
        <div class="quiz-result" id="quiz-result"></div>
        <button class="btn btn-primary btn-block btn-next" id="btn-next">下一张 →</button>
      </div>
    `;

    const resultEl = quizEl.querySelector('#quiz-result');
    const nextBtn = quizEl.querySelector('#btn-next');
    const revealBtn = document.getElementById('btn-memory-reveal');
    revealBtn.onclick = () => {
      document.getElementById('memory-back').classList.remove('hidden');
    };
    revealBtn.setAttribute('aria-label', '显示答案');

    // Keyboard: Space/Enter to reveal, then 1=认识, 2=不认识
    const keyHandler = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const back = document.getElementById('memory-back');
        if (back && back.classList.contains('hidden')) {
          revealBtn.click();
        } else if (this.lock && nextBtn.classList.contains('show')) {
          nextBtn.click();
        }
      }
      if (!this.lock) {
        if (e.key === '1') {
          e.preventDefault();
          const btn = quizEl.querySelector('[data-known="1"]');
          if (btn && !document.getElementById('memory-back').classList.contains('hidden')) btn.click();
        }
        if (e.key === '2') {
          e.preventDefault();
          const btn = quizEl.querySelector('[data-known="0"]');
          if (btn && !document.getElementById('memory-back').classList.contains('hidden')) btn.click();
        }
      }
    };
    document.addEventListener('keydown', keyHandler);
    this._keyHandler = keyHandler;

    quizEl.querySelectorAll('[data-known]').forEach((btn) => {
      btn.setAttribute('aria-label', btn.dataset.known === '1' ? '认识' : '不认识');
      btn.addEventListener('click', () => {
        document.removeEventListener('keydown', keyHandler);
        this.submitMemory(card, btn.dataset.known === '1', quizEl, resultEl, nextBtn);
      });
    });
    nextBtn.addEventListener('click', () => {
      document.removeEventListener('keydown', this._keyHandler);
      this.renderMemoryCard(index + 1);
      this.renderProgress();
    });
    nextBtn.setAttribute('aria-label', '下一张');
  },

  async submitMemory(card, known, quizEl, resultEl, nextBtn) {
    if (this.lock) return;
    this.lock = true;
    try {
      const data = await API.post(`/api/cards/${card.card_id}/memory-answer`, {
        known,
        mode: this.mode,
        level_no: this.levelNo
      });
      const ok = !!data.correct;
      resultEl.className = 'quiz-result show ' + (ok ? 'correct-result' : 'wrong-result');
      resultEl.innerHTML = `
        <div class="result-text">
          <span class="result-icon">${ok ? '✅' : '❌'}</span>
          ${ok ? '认识，回答正确！' : '不认识，已记为错题'}
        </div>
      `;
      nextBtn.classList.add('show');
      if (ok) {
        this.completed++;
      } else {
        const updated = { ...card, wrong_count: (card.wrong_count || 0) + 1 };
        const dupIndex = this.cards.findIndex((c, i) => i > this.currentIndex && c.card_id === card.card_id);
        if (dupIndex !== -1) this.cards[dupIndex] = updated;
        else this.cards.push(updated);
      }
      this.renderProgress();
    } catch (e) {
      this.lock = false;
      Toast.show(e.message, 'error');
    }
  },

  async renderDone(data) {
    const done = document.getElementById('learn-done');
    const backBtn = document.getElementById('btn-back-home-done');
    const nextBtn = document.getElementById('btn-next-level');
    nextBtn.classList.add('hidden');

    if (this.mode === 'wrong') {
      document.getElementById('learn-progress').innerHTML = '';
      document.getElementById('card-quiz').innerHTML = '';
      done.classList.remove('hidden');
      const memoryLabel = this.kind === 'memory';
      document.getElementById('done-title').textContent = this.totalCount === 0
        ? (memoryLabel ? '暂无记忆错题' : '暂无错题')
        : (memoryLabel ? '记忆练习完成！' : '错题复习完成！');
      document.getElementById('done-msg').textContent = this.totalCount === 0
        ? (memoryLabel ? '先去记忆卡学习积累错题，再回来复习吧~' : '先去闯关积累错题，再回来复习吧~')
        : (memoryLabel ? '本次记忆卡已全部练完，继续保持！' : '本次错题已全部练完，继续保持！');
      backBtn.textContent = '返回路径';
      backBtn.onclick = () => {
        if (this.onDone) this.onDone();
        else this.refreshProgressAndNavigate('zone', this.currentZoneId);
      };
      return;
    }

    let progress = this.progress;
    if (this.mode !== 'replay') {
      try {
        progress = await API.get(`/api/zones/${this.currentZoneId}/progress`);
        this.progress = progress;
      } catch (e) {
        // progress is optional
      }
    }

    const hasMore = (progress && progress.levels || []).some(lv => lv.status === '待闯关');
    document.getElementById('learn-progress').innerHTML = '';
    document.getElementById('card-quiz').innerHTML = '';
    done.classList.remove('hidden');
    backBtn.textContent = '返回路径';
    backBtn.onclick = () => this.refreshProgressAndNavigate('zone', this.currentZoneId);

    if (this.mode === 'replay') {
      document.getElementById('done-title').textContent = '本关练习完成！';
      document.getElementById('done-msg').textContent = '随时可以回到路径继续闯关';
      return;
    }

    document.getElementById('done-title').textContent = '本关完成！';
    document.getElementById('done-msg').textContent = progress && progress.checked_today
      ? `打卡成功！连续打卡 ${progress.streak} 天`
      : '今日任务已完成，继续保持！';
    if (hasMore) {
      nextBtn.classList.remove('hidden');
      nextBtn.onclick = () => this.refreshProgressAndNavigate('learn', this.currentZoneId);
    }
  },

  async renderWrong(zoneId) {
    this.currentZoneId = zoneId;
    const tpl = document.getElementById('tpl-wrong');
    App.setPage(tpl);

    document.getElementById('btn-back-zone-wrong').onclick = () => App.navigate('zone', zoneId);
    document.getElementById('btn-wrong-practice').onclick = async () => {
      try {
        const data = await API.post(`/api/zones/${zoneId}/wrong-practice?kind=${this.wrongKind}`);
        if (data.added > 0) {
          Toast.show(`已加入 ${data.added} 条错题`, 'success');
        } else {
          Toast.show('错题已在今日练习中');
        }
        App.navigate('learn', zoneId);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    };
    document.getElementById('btn-wrong-start').onclick = () => App.navigate('wrong-practice', zoneId);

    try {
      const zone = await API.get(`/api/zones/${zoneId}`);
      this.wrongKind = zone.zone && zone.zone.study_mode === 'memory' ? 'memory' : 'quiz';
      const data = await API.get(`/api/zones/${zoneId}/wrong-cards?kind=${this.wrongKind}`);
      const cards = data.wrong_cards || [];
      const listEl = document.getElementById('wrong-list');
      const emptyEl = document.getElementById('wrong-empty');
      if (cards.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      listEl.innerHTML = cards.map(c => {
        if (this.wrongKind === 'memory') {
          return `
            <div class="wrong-item">
              <div class="wrong-head">
                <span class="badge-review">错 ${c.wrong_times} 次</span>
                <span class="wrong-title">${Utils.esc(c.title)}</span>
              </div>
              <div class="wrong-question">${Utils.esc(c.back_detail || '')}</div>
              ${c.path ? `<div class="wrong-answer">路径：${Utils.esc(c.path)}</div>` : ''}
            </div>
          `;
        }
        const answerText = c['option_' + String(c.answer).toLowerCase()] || '';
        return `
          <div class="wrong-item">
            <div class="wrong-head">
              <span class="badge-review">错 ${c.wrong_times} 次</span>
              <span class="wrong-title">${Utils.esc(c.title)}</span>
            </div>
            <div class="wrong-question">${Utils.esc(c.question)}</div>
            <div class="wrong-answer">正确答案：${Utils.esc(c.answer)} · ${Utils.esc(answerText)}</div>
            <div class="wrong-explanation">${Utils.esc(c.explanation)}</div>
          </div>
        `;
      }).join('');
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  }
};
