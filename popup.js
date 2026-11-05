(() => {
  "use strict";

  const STORAGE_KEY = "kickmycardStats";
  const formatter = new Intl.NumberFormat("ar");

  const elements = {
    total: document.getElementById("total-count"),
    modal: document.getElementById("modal-count"),
    overlay: document.getElementById("overlay-count"),
    footnote: document.getElementById("footnote")
  };

  /**
   * Returns a valid non-negative counter, defaulting corrupted values to zero.
   * @param {unknown} value Value read from local extension storage.
   * @returns {number} Safe counter value.
   */
  function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  /**
   * Updates all visible counters from the persisted statistics object.
   * @param {{modal?: number, overlay?: number}|undefined} stats Stored statistics.
   */
  function render(stats = {}) {
    const modal = safeCount(stats.modal);
    const overlay = safeCount(stats.overlay);

    elements.modal.textContent = formatter.format(modal);
    elements.overlay.textContent = formatter.format(overlay);
    elements.total.textContent = formatter.format(modal + overlay);
  }

  /**
   * Loads the latest counters from Chrome's local extension storage.
   */
  async function loadStats() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    render(stored[STORAGE_KEY]);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    render(changes[STORAGE_KEY].newValue);
  });

  loadStats().catch(() => {
    elements.footnote.textContent = "تعذّر تحميل الإحصاءات.";
  });
})();
