// Tabs Component — Feishu-style tab switcher
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.Components = root.Components || {}; root.Components.Tabs = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  function create(container, tabs, activeIndex, onChange) {
    container.innerHTML = `
      <div class="segmented" role="tablist">
        ${tabs.map((t, i) => `
          <button class="segmented-btn ${i === (activeIndex || 0) ? 'active' : ''}"
                  role="tab" aria-selected="${i === (activeIndex || 0)}"
                  data-index="${i}">${t}</button>
        `).join('')}
      </div>`;
    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.segmented-btn').forEach((b) => {
          b.classList.remove('active'); b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        if (onChange) onChange(parseInt(btn.dataset.index), btn.dataset.index);
      });
    });
    return {
      setActive(index) {
        container.querySelectorAll('.segmented-btn').forEach((b, i) => {
          b.classList.toggle('active', i === index);
          b.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });
      }
    };
  }
  return { create };
});
