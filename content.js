(() => {
  "use strict";

  const ANTI_ADBLOCK_MESSAGE =
    /(?:يرجى\s+تعطيل|قم\s+بتعطيل)\s+مانع\s+الإعلان(?:ات|ا+ت)/u;
  const BACKDROP_SELECTOR =
    '[x-show="isOpen"][x-on\\:click="close"]';

  function hideElement(element) {
    if (!element || !element.style) return;

    const alreadyHidden =
      element.style.getPropertyValue("display") === "none" &&
      element.style.getPropertyPriority("display") === "important";

    if (alreadyHidden) return;

    element.style.setProperty("display", "none", "important");
    element.setAttribute("aria-hidden", "true");
  }

  function containsAntiAdblockMessage(element) {
    const text = (element.textContent || "").replace(/\s+/g, " ");
    return ANTI_ADBLOCK_MESSAGE.test(text);
  }

  function hideAntiAdblockModal() {
    let foundModal = false;

    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!containsAntiAdblockMessage(dialog)) continue;

      foundModal = true;
      const shell = dialog.parentElement;
      const isModalShell =
        shell &&
        shell.classList &&
        shell.classList.contains("min-h-full") &&
        shell.classList.contains("justify-center");

      hideElement(isModalShell ? shell : dialog);
    }

    if (!foundModal) return;

    for (const backdrop of document.querySelectorAll(BACKDROP_SELECTOR)) {
      if (
        backdrop.classList &&
        backdrop.classList.contains("fixed") &&
        backdrop.classList.contains("z-50")
      ) {
        hideElement(backdrop);
      }
    }
  }

  function isFullScreenAdOverlay(anchor) {
    const rawHref = anchor.href || anchor.getAttribute("href");
    if (!rawHref) return false;

    let destination;
    try {
      destination = new URL(rawHref, location.href);
    } catch {
      return false;
    }

    const knownAdHost =
      destination.hostname === "hai8g.com" ||
      destination.hostname.endsWith(".hai8g.com");

    const style = window.getComputedStyle(anchor);
    if (style.position !== "fixed") return false;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;

    const coversViewport =
      rect.width >= viewportWidth - 2 &&
      rect.height >= viewportHeight - 2 &&
      rect.top <= 2 &&
      rect.left <= 2;

    if (!coversViewport) return false;

    const zIndex = Number.parseInt(style.zIndex || "0", 10) || 0;
    const matchesOverlaySignature =
      zIndex >= 999 && style.cursor === "default";

    return knownAdHost || matchesOverlaySignature;
  }

  function inspectAnchor(anchor) {
    if (!anchor || anchor.tagName !== "A") return;

    if (isFullScreenAdOverlay(anchor)) {
      hideElement(anchor);
    }
  }

  function inspectAnchors(root) {
    if (root === document) {
      for (const anchor of document.querySelectorAll("a[href]")) {
        inspectAnchor(anchor);
      }
      return;
    }

    if (!root || root.nodeType !== 1) return;

    inspectAnchor(root);
    for (const anchor of root.querySelectorAll("a[href]")) {
      inspectAnchor(anchor);
    }
  }

  function isInsideDialog(element) {
    return Boolean(
      element &&
      element.nodeType === 1 &&
      (
        (element.matches && element.matches('[role="dialog"]')) ||
        (element.closest && element.closest('[role="dialog"]'))
      )
    );
  }

  function containsDialog(element) {
    return Boolean(
      element &&
      element.nodeType === 1 &&
      (
        (element.matches && element.matches('[role="dialog"]')) ||
        (element.querySelector && element.querySelector('[role="dialog"]'))
      )
    );
  }

  function handleMutations(records) {
    let shouldInspectDialogs = false;

    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.tagName === "A") {
          inspectAnchor(record.target);
        }

        if (
          isInsideDialog(record.target) ||
          containsDialog(record.target)
        ) {
          shouldInspectDialogs = true;
        }

        continue;
      }

      if (record.type !== "childList") continue;

      if (isInsideDialog(record.target)) {
        shouldInspectDialogs = true;
      }

      for (const addedNode of record.addedNodes) {
        inspectAnchors(addedNode);

        if (
          isInsideDialog(addedNode) ||
          containsDialog(addedNode)
        ) {
          shouldInspectDialogs = true;
        }
      }
    }

    if (shouldInspectDialogs) {
      hideAntiAdblockModal();
    }
  }

  inspectAnchors(document);
  hideAntiAdblockModal();

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "href", "class"]
  });
})();
