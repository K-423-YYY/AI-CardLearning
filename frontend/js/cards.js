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
      this.renderCard(0);
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
      document.getElementById('learn-title').textContent = `第 ${progress.current_level} 关 · ${data.level_type === '复习' ? '复习' : '新学'} (每日 ${data.daily_limit} 张)`;
      
      if (data.completed || this.cards.length === 0) {
        this.renderDone(data);
        return;
      }

      this.renderProgress();
      this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  // Render standalone wrong-card practice
  async renderWrongPractice(zoneId) {
    this.currentZoneId = zoneId;
    this.levelNo = null;
    this.mode = 'wrong';
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
      const data = await API.get(`/api/zones/${zoneId}/wrong-practice`);
      this.cards = data.cards || [];
      this.totalCount = this.cards.length;
      document.getElementById('learn-title').textContent = `错题复习 (${this.totalCount} 道)`;

      if (this.cards.length === 0) {
        this.renderDone(data);
        return;
      }

      this.renderProgress();
      this.renderCard(0);
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  },

  renderProgress() {
    const done = this.completed;
    const total = this.totalCount;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const label = this.mode === 'replay' ? '本关任务' : this.mode === 'wrong' ? '错题练习' : '今日任务';
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

    // Click option
    optionsEl.querySelectorAll('.quiz-option').forEach(opt => {
      opt.addEventListener('click', () => {
        if (this.lock) return;
        this.lock = true;
        const letter = opt.dataset.letter;
        // Mark all with disabled
        optionsEl.querySelectorAll('.quiz-option').forEach(o => o.classList.add('disabled'));
        opt.classList.add('selected');

        this.submitAnswer(card.card_id, letter, opt, optionsEl, resultEl, nextBtn);
      });
    });

    nextBtn.addEventListener('click', () => {
      this.renderCard(index + 1);
      this.renderProgress();
    });
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

  async renderDone(data) {
    const done = document.getElementById('learn-done');
    const backBtn = document.getElementById('btn-back-home-done');
    const nextBtn = document.getElementById('btn-next-level');
    nextBtn.classList.add('hidden');

    if (this.mode === 'wrong') {
      document.getElementById('learn-progress').innerHTML = '';
      document.getElementById('card-quiz').innerHTML = '';
      done.classList.remove('hidden');
      document.getElementById('done-title').textContent = this.totalCount === 0 ? '暂无错题' : '错题复习完成！';
      document.getElementById('done-msg').textContent = this.totalCount === 0
        ? '先去闯关积累错题，再回来复习吧~'
        : '本次错题已全部练完，继续保持！';
      backBtn.textContent = '返回路径';
      backBtn.onclick = () => this.refreshProgressAndNavigate('zone', this.currentZoneId);
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
        const data = await API.post(`/api/zones/${zoneId}/wrong-practice`);
        if (data.added > 0) {
          Toast.show(`已加入 ${data.added} 道错题`, 'success');
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
      const data = await API.get(`/api/zones/${zoneId}/wrong-cards`);
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
