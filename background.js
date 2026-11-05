"use strict";

const STORAGE_KEY = "kickmycardStats";
const COUNTER_TYPES = new Set(["modal", "overlay"]);

let pendingUpdates = Promise.resolve();

/**
 * Converts stored statistics to safe non-negative integer counters.
 * @param {unknown} value Previously stored statistics.
 * @returns {{modal: number, overlay: number}} Normalized counters.
 */
function normalizeStats(value) {
  const stats = value && typeof value === "object" ? value : {};
  return {
    modal: Number.isSafeInteger(stats.modal) && stats.modal >= 0 ? stats.modal : 0,
    overlay: Number.isSafeInteger(stats.overlay) && stats.overlay >= 0 ? stats.overlay : 0
  };
}

/**
 * Serializes counter updates so simultaneous tabs do not overwrite one another.
 * @param {string} target Counter to increment.
 * @returns {Promise<{modal: number, overlay: number}>} Updated counters.
 */
function incrementCounter(target) {
  const update = pendingUpdates.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const stats = normalizeStats(stored[STORAGE_KEY]);
    stats[target] += 1;
    await chrome.storage.local.set({ [STORAGE_KEY]: stats });
    return stats;
  });

  pendingUpdates = update;
  return update;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    !message ||
    message.type !== "kickmycard:hidden" ||
    !COUNTER_TYPES.has(message.target)
  ) {
    return false;
  }

  incrementCounter(message.target).then(
    (stats) => sendResponse({ ok: true, stats }),
    (error) => {
      console.error("KickMyCard: failed to save blocking statistics.", error);
      sendResponse({ ok: false });
    }
  );

  // Keep the message channel open until the storage update completes.
  return true;
});
