// Chat Dialog Component — Reusable AI conversation interface
// Usage: ChatDialog.create(container, { onSend, placeholder, stages })
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatDialog = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function create(container, options) {
    const opts = options || {};
    let messages = opts.messages || [];
    let loading = false;
    let stage = opts.stage || 1;
    let totalStages = opts.totalStages || 4;

    function render() {
      const stageLabels = [
        '', '结构范围分析', '知识延伸补充', '结构化拆解', '生成卡片'
      ];

      // Stage progress indicator
      let progressHtml = '<div class="stage-progress">';
      for (let i = 1; i <= totalStages; i++) {
        if (i > 1) {
          progressHtml += `<div class="stage-line ${i <= stage ? 'done' : ''}"></div>`;
        }
        const stateCls = i < stage ? 'done' : i === stage ? 'active' : '';
        progressHtml += `<div class="stage-dot ${stateCls}">${i < stage ? '✓' : i}</div>`;
      }
      progressHtml += '</div>';

      // Stage label
      const stageLabel = stageLabels[stage] || '';

      // Messages HTML
      let messagesHtml = '';
      messages.forEach((msg) => {
        if (msg.role === 'ai') {
          messagesHtml += `
            <div class="chat-msg ai">
              <div class="chat-msg-avatar">🤖</div>
              <div class="chat-msg-bubble">
                ${msg.html || esc(msg.content || '')}
                ${msg.card ? `<div class="chat-card">${msg.card}</div>` : ''}
                ${msg.actions ? `<div class="chat-actions">${msg.actions}</div>` : ''}
              </div>
            </div>`;
        } else {
          messagesHtml += `
            <div class="chat-msg user">
              <div class="chat-msg-avatar">👤</div>
              <div class="chat-msg-bubble">${esc(msg.content || '')}</div>
            </div>`;
        }
      });

      // Loading indicator
      if (loading) {
        messagesHtml += `
          <div class="chat-msg ai">
            <div class="chat-msg-avatar">🤖</div>
            <div class="chat-msg-bubble">
              <div class="spinner" style="margin:0 auto"></div>
            </div>
          </div>`;
      }

      // Action buttons
      let actionsHtml = '';
      if (opts.actions && opts.actions.length) {
        actionsHtml = '<div class="chat-actions-row">' +
          opts.actions.map((a) =>
            `<button class="btn ${a.cls || 'btn-outline'} btn-sm" data-action="${a.id}">${esc(a.label)}</button>`
          ).join('') +
          '</div>';
      }

      container.innerHTML = `
        <div class="ai-chat-container">
          <div class="ai-chat-header">
            <div class="stage-label">第${stage}阶段 · ${stageLabel}</div>
            ${progressHtml}
          </div>
          <div class="ai-chat-messages" id="chat-messages">${messagesHtml}</div>
          <div class="ai-chat-input-area" id="chat-input-area">
            ${opts.showInput !== false ? `
              <input class="ai-chat-input" id="chat-input" type="text"
                     placeholder="${esc(opts.placeholder || '输入微调指令，让 AI 针对此阶段进行调整…')}"
                     autocomplete="off">
              <button class="btn btn-primary btn-sm" id="chat-send">发送</button>
            ` : ''}
            ${actionsHtml}
          </div>
        </div>
      `;

      // Scroll to bottom
      const msgEl = container.querySelector('#chat-messages');
      if (msgEl) {
        msgEl.scrollTop = msgEl.scrollHeight;
      }

      // Bind events
      bindEvents();
    }

    function bindEvents() {
      const input = container.querySelector('#chat-input');
      const sendBtn = container.querySelector('#chat-send');

      const doSend = () => {
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (opts.onSend) opts.onSend(text, () => {
          input.disabled = false;
          if (sendBtn) sendBtn.disabled = false;
          input.focus();
        });
      };

      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
          }
        });
      }
      if (sendBtn) {
        sendBtn.addEventListener('click', doSend);
      }

      // Action buttons
      container.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (opts.onAction) opts.onAction(btn.dataset.action);
        });
      });
    }

    // Public API
    return {
      render,

      setMessages(newMessages) {
        messages = newMessages;
        render();
      },

      addMessage(msg) {
        messages.push(msg);
        const msgEl = container.querySelector('#chat-messages');
        if (msgEl) {
          const bubble = document.createElement('div');
          bubble.className = 'chat-msg ' + (msg.role === 'ai' ? 'ai' : 'user');
          if (msg.role === 'ai') {
            bubble.innerHTML = `
              <div class="chat-msg-avatar">🤖</div>
              <div class="chat-msg-bubble">${msg.html || esc(msg.content || '')}</div>`;
          } else {
            bubble.innerHTML = `
              <div class="chat-msg-avatar">👤</div>
              <div class="chat-msg-bubble">${esc(msg.content || '')}</div>`;
          }
          msgEl.appendChild(bubble);
          msgEl.scrollTop = msgEl.scrollHeight;
        }
      },

      setLoading(show) {
        loading = show;
        const msgEl = container.querySelector('#chat-messages');
        if (!msgEl) return;
        const existing = msgEl.querySelector('.chat-msg-loading');
        if (show && !existing) {
          const loader = document.createElement('div');
          loader.className = 'chat-msg ai chat-msg-loading';
          loader.innerHTML = '<div class="chat-msg-avatar">🤖</div><div class="chat-msg-bubble"><div class="spinner" style="margin:0 auto"></div></div>';
          msgEl.appendChild(loader);
          msgEl.scrollTop = msgEl.scrollHeight;
        } else if (!show && existing) {
          existing.remove();
        }
      },

      setStage(s) {
        stage = s;
        render();
      },

      setActions(newActions) {
        opts.actions = newActions;
        const inputArea = container.querySelector('#chat-input-area');
        if (inputArea) {
          let html = '';
          if (opts.showInput !== false) {
            html += `
              <input class="ai-chat-input" id="chat-input" type="text"
                     placeholder="${esc(opts.placeholder || '输入微调指令…')}" autocomplete="off">
              <button class="btn btn-primary btn-sm" id="chat-send">发送</button>`;
          }
          if (newActions && newActions.length) {
            html += '<div class="chat-actions-row">' +
              newActions.map((a) =>
                `<button class="btn ${a.cls || 'btn-outline'} btn-sm" data-action="${a.id}">${esc(a.label)}</button>`
              ).join('') +
              '</div>';
          }
          inputArea.innerHTML = html;
          bindEvents();
        }
      },

      destroy() {
        container.innerHTML = '';
      }
    };
  }

  return { create };
});
