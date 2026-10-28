(() => {
  'use strict';
  let current = null;
  const selector = '.match-perf-detail, .me-perf';
  function close(restoreFocus = false) {
    if (!current) return;
    const { detail, summary, panel, placeholder } = current;
    current = null;
    detail.open = false;
    summary.setAttribute('aria-expanded', 'false');
    panel.removeAttribute('style');
    panel.classList.remove('score-popover-active');
    if (placeholder.parentNode) placeholder.replaceWith(panel);
    else panel.remove();
    if (restoreFocus && summary.isConnected) summary.focus();
  }
  function place() {
    if (!current) return;
    const { summary, panel } = current;
    if (!summary.isConnected) { close(); return; }
    const rect = summary.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    const height = Math.min(panel.scrollHeight, window.innerHeight - 16);
    const below = window.innerHeight - rect.bottom - 8;
    const top = below >= height || below >= rect.top - 8
      ? Math.min(rect.bottom + 6, window.innerHeight - height - 8)
      : Math.max(8, rect.top - height - 6);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, top)}px`;
  }
  document.addEventListener('toggle', event => {
    const detail = event.target;
    if (!detail.matches?.(selector)) return;
    if (!detail.open) { if (current?.detail === detail) close(); return; }
    close();
    const summary = detail.querySelector('summary');
    const panel = detail.querySelector('.match-perf-pop, .me-perf > span');
    if (!summary || !panel) return;
    const placeholder = document.createComment('score popover');
    panel.replaceWith(placeholder);
    document.body.append(panel);
    panel.classList.add('score-popover-active');
    summary.setAttribute('aria-expanded', 'true');
    current = { detail, summary, panel, placeholder };
    place();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (current && !current.detail.contains(event.target) && !current.panel.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current) { event.preventDefault(); close(true); }
  });
  window.addEventListener('scroll', event => {
    if (current && event.target !== current.panel && !current.panel.contains(event.target)) close();
  }, true);
  window.addEventListener('resize', place);
})();
