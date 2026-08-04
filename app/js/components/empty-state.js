// Empty State Component — Feishu-style placeholder
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.Components = root.Components || {}; root.Components.EmptyState = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  function create(container, icon, title, hint, actionLabel, actionFn) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon || '📭'}</div>
        <div class="empty-title">${title || '暂无内容'}</div>
        ${hint ? `<div class="empty-hint">${hint}</div>` : ''}
        ${actionLabel ? `<button class="btn btn-primary btn-sm" style="margin-top:16px">${actionLabel}</button>` : ''}
      </div>`;
    if (actionFn && actionLabel) {
      const btn = container.querySelector('button');
      if (btn) btn.addEventListener('click', actionFn);
    }
    return {
      update(icon2, title2, hint2) {
        container.querySelector('.empty-icon').textContent = icon2 || '📭';
        container.querySelector('.empty-title').textContent = title2 || '';
        const hintEl = container.querySelector('.empty-hint');
        if (hintEl) hintEl.textContent = hint2 || '';
      }
    };
  }
  return { create };
});
