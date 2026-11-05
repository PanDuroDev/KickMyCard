(() => {
  "use strict";

  const ANTI_ADBLOCK_MESSAGE =
    /(?:يرجى\s+تعطيل|قم\s+بتعطيل)\s+مانع\s+الإعلان(?:ات|ا+ت)/u;

  /**
   * Determines whether an element is currently rendered and, when requested,
   * able to receive pointer input. Hidden ancestors and zero-opacity layers
   * are treated as not visible.
   * @param {Element|null} element Element to inspect.
   * @param {{requirePointerEvents?: boolean}} options Visibility requirements.
   * @returns {boolean} Whether the element is currently visible to the user.
   */
  function isEffectivelyVisible(element, options = {}) {
    if (!element || !element.getBoundingClientRect) return false;

    for (
      let ancestor = element;
      ancestor && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.nodeType !== 1) continue;

      const style = window.getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden"
      ) {
        return false;
      }

      // Opacity zero hides a dialog visually, but a transparent anchor can
      // still intercept pointer input. Hit-testing decides overlay eligibility.
      const opacity = Number.parseFloat(style.opacity);
      if (
        !options.requirePointerEvents &&
        Number.isFinite(opacity) &&
        opacity <= 0
      ) {
        return false;
      }

      if (
        options.requirePointerEvents &&
        (
          (ancestor === element && style.pointerEvents === "none") ||
          ancestor.inert === true ||
          (ancestor.hasAttribute && ancestor.hasAttribute("inert"))
        )
      ) {
        return false;
      }
    }

    const rect = element.getBoundingClientRect();
    const width = Number(rect.width) || 0;
    const height = Number(rect.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const left = Number(rect.left) || 0;
    const top = Number(rect.top) || 0;
    const right = Number.isFinite(rect.right) ? rect.right : left + width;
    const bottom = Number.isFinite(rect.bottom) ? rect.bottom : top + height;
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;

    const intersectsViewport =
      right > 0 &&
      bottom > 0 &&
      left < viewportWidth &&
      top < viewportHeight;

    if (!intersectsViewport) return false;

    if (options.requirePointerEvents && typeof document.elementFromPoint === "function") {
      const samplePositions = [0.1, 0.5, 0.9];
      let hitCount = 0;

      for (const xRatio of samplePositions) {
        for (const yRatio of samplePositions) {
          const x = viewportWidth * xRatio;
          const y = viewportHeight * yRatio;
          const hit = document.elementFromPoint(x, y);

          if (
            hit === element ||
            (hit && element.contains && element.contains(hit))
          ) {
            hitCount += 1;
          }
        }
      }

      // A full-screen overlay must be the actual hit target across most of the viewport.
      if (hitCount < 5) return false;
    }

    return true;
  }

  /**
   * Hides a currently visible matching element and records only a real change.
   * @param {Element|null} element Element to hide.
   * @param {"modal"|"overlay"} counterType Counter category.
   */
  function hideElement(element, counterType) {
    if (!isEffectivelyVisible(element, {
      requirePointerEvents: counterType === "overlay"
    })) {
      return false;
    }

    element.style.setProperty("display", "none", "important");
    element.setAttribute("aria-hidden", "true");

    // Count only after the inline hiding change was successfully applied.
    if (
      element.style.getPropertyValue("display") !== "none" ||
      element.style.getPropertyPriority("display") !== "important" ||
      window.getComputedStyle(element).display !== "none"
    ) {
      return false;
    }

    try {
      const pending = chrome.runtime.sendMessage({
        type: "kickmycard:hidden",
        target: counterType
      });
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    } catch {
      // Blocking must continue even when statistics cannot be recorded.
    }

    return true;
  }

  /**
   * Checks whether an element contains the supported Arabic anti-adblock message.
   * @param {Element} element Element whose text should be checked.
   * @returns {boolean} True when the message is present.
   */
  function containsAntiAdblockMessage(element) {
    const text = (element.textContent || "").replace(/\s+/g, " ");
    return ANTI_ADBLOCK_MESSAGE.test(text);
  }

  /**
   * Finds the supplied page's full-screen modal wrapper around a dialog.
   * @param {Element} dialog Anti-adblock dialog element.
   * @returns {Element|null} Matching backdrop wrapper, if present.
   */
  function findAntiAdblockBackdrop(dialog) {
    for (
      let ancestor = dialog.parentElement;
      ancestor && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement
    ) {
      const classes = ancestor.classList;
      if (
        classes &&
        classes.contains("fixed") &&
        classes.contains("h-full") &&
        classes.contains("bg-black/60") &&
        classes.contains("z-50")
      ) {
        return ancestor;
      }
    }

    return null;
  }

  /**
   * Hides only anti-adblock dialogs that are actually visible.
   */
  function hideAntiAdblockModal() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (
        !containsAntiAdblockMessage(dialog) ||
        !isEffectivelyVisible(dialog)
      ) {
        continue;
      }

      // Hide the full-screen modal wrapper, not just the inner dialog.
      // Alpine's generated x-on:* event name changes between renders.
      const backdrop = findAntiAdblockBackdrop(dialog);
      hideElement(backdrop || dialog, "modal");
    }
  }

  /**
   * Identifies a fixed anchor covering the viewport and matching the ad signature.
   * @param {HTMLAnchorElement} anchor Anchor to inspect.
   * @returns {boolean} True when the anchor is the known click-interception layer.
   */
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

  /**
   * Hides an anchor when it is a visible, interactive full-screen ad overlay.
   * @param {Element} anchor Candidate anchor.
   */
  function inspectAnchor(anchor) {
    if (!anchor || anchor.tagName !== "A") return;

    if (isFullScreenAdOverlay(anchor)) {
      return hideElement(anchor, "overlay");
    }

    return false;
  }

  /**
   * Inspects an element and all descendant anchors for click-interception overlays.
   * @param {Document|Element} root Search root.
   */
  function inspectAnchors(root) {
    if (!root || (root !== document && root.nodeType !== 1)) return;

    // Hiding a top overlay can expose another matching overlay underneath it.
    // Repeat the scoped scan while each pass successfully hides an element.
    let didHideElement;
    do {
      didHideElement = false;

      const anchors = root === document
        ? document.querySelectorAll("a[href]")
        : [
            ...(root.matches && root.matches("a[href]") ? [root] : []),
            ...root.querySelectorAll("a[href]")
          ];

      for (const anchor of anchors) {
        if (inspectAnchor(anchor)) {
          didHideElement = true;
        }
      }
    } while (didHideElement);
  }

  /**
   * Checks whether an element or text node is inside a dialog.
   * @param {Node|null} node Node to check.
   * @returns {boolean} True when the node belongs to a dialog subtree.
   */
  function isInsideDialog(node) {
    let element = node && node.nodeType === 1
      ? node
      : node && (node.parentElement || node.parentNode);

    while (element && element !== document.documentElement) {
      if (
        element.nodeType === 1 &&
        element.matches &&
        element.matches('[role="dialog"]')
      ) {
        return true;
      }
      element = element.parentElement;
    }

    return false;
  }

  /**
   * Checks whether an element is or contains a dialog.
   * @param {Element|null} element Candidate element.
   * @returns {boolean} True when a dialog is found.
   */
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

  /**
   * Processes DOM changes and rechecks affected anchors and visible dialogs.
   * @param {MutationRecord[]} records Mutation records reported by the observer.
   */
  function handleMutations(records) {
    let shouldInspectDialogs = false;

    for (const record of records) {
      if (record.type === "attributes") {
        const target = record.target;
        const attributeName = record.attributeName;

        if (
          attributeName === "style" ||
          attributeName === "class" ||
          (attributeName === "href" && target.tagName === "A")
        ) {
          // Ancestor style/class changes can activate a descendant overlay.
          inspectAnchors(target);
        }

        if (
          isInsideDialog(target) ||
          containsDialog(target)
        ) {
          shouldInspectDialogs = true;
        }

        continue;
      }

      if (record.type === "characterData") {
        if (isInsideDialog(record.target)) {
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
    attributeFilter: ["style", "href", "class", "role"],
    characterData: true
  });
})();
