import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../content.js", import.meta.url),
  "utf8"
);

/** Minimal CSSStyleDeclaration substitute for deterministic DOM tests. */
class FakeStyle {
  constructor() {
    this.values = new Map();
    this.priorities = new Map();
  }

  /** Returns a stored CSS property value. */
  getPropertyValue(name) {
    return this.values.get(name) || "";
  }

  /** Returns a stored CSS property priority. */
  getPropertyPriority(name) {
    return this.priorities.get(name) || "";
  }

  /** Stores a CSS property value and its priority. */
  setProperty(name, value, priority = "") {
    this.values.set(name, value);
    this.priorities.set(name, priority);
  }
}

/** Minimal classList substitute used by the content-script harness. */
class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  /** Checks whether a class token is present. */
  contains(value) {
    return this.values.has(value);
  }
}

/** Small DOM element model supporting the selectors used by content.js. */
class FakeElement {
  constructor({
    tagName = "div",
    text = "",
    classes = [],
    attributes = {},
    href = "",
    rect = { width: 1000, height: 800, top: 0, left: 0 },
    computedStyle = {}
  } = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.classList = new FakeClassList(classes);
    this.attributes = new Map(Object.entries(attributes));
    this.style = new FakeStyle();
    this.href = href;
    this.rect = rect;
    this.computedStyle = computedStyle;
    this.children = [];
    this.parentElement = null;
  }

  /** Appends a child and assigns its parent relationship. */
  append(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  /** Reads an attribute from the fake element. */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  /** Writes an attribute to the fake element. */
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  /** Supports the role and anchor selectors used by the extension. */
  matches(selector) {
    if (selector === '[role="dialog"]') {
      return this.getAttribute("role") === "dialog";
    }
    if (selector === "a[href]") {
      return this.tagName === "A" &&
        Boolean(this.href || this.getAttribute("href"));
    }
    return false;
  }

  /** Finds the nearest matching ancestor, including this element. */
  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  /** Returns the first matching descendant. */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /** Returns all matching descendants in document order. */
  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  /** Checks whether another element belongs to this element's subtree. */
  contains(element) {
    for (let current = element; current; current = current.parentElement || current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  /** Returns the configured viewport rectangle. */
  getBoundingClientRect() {
    return this.rect;
  }
}

/** Text-node model for characterData mutation coverage. */
class FakeTextNode {
  constructor(parentNode) {
    this.nodeType = 3;
    this.parentNode = parentNode;
  }
}

/**
 * Executes content.js in an isolated fake DOM and exposes its observer.
 * @param {FakeElement[]} initialNodes Nodes present before script startup.
 * @returns {{nodes: FakeElement[], observer: object, documentElement: FakeElement}}
 */
function createHarness(initialNodes = [], hitTestTarget = null, options = {}) {
  const nodes = [...initialNodes];
  const observers = [];
  const messages = [];
  let hitTestOverride = hitTestTarget ? () => hitTestTarget : null;
  const documentElement = options.withoutDocumentElement
    ? null
    : new FakeElement({ tagName: "html" });

  const document = {
    documentElement,
    elementFromPoint() {
      if (hitTestOverride) return hitTestOverride();

      const anchors = [];
      const visit = (element) => {
        if (element.matches("a[href]")) anchors.push(element);
        for (const child of element.children) visit(child);
      };
      for (const node of nodes) visit(node);

      return anchors.reverse().find((anchor) => {
        const style = {
          display: "block",
          visibility: "visible",
          pointerEvents: "auto",
          ...anchor.computedStyle,
          ...(anchor.style.getPropertyValue("display")
            ? { display: anchor.style.getPropertyValue("display") }
            : {})
        };

        if (style.display === "none" || style.visibility === "hidden" ||
            style.pointerEvents === "none") {
          return false;
        }

        for (
          let ancestor = anchor.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          if (ancestor.inert || ancestor.attributes?.has("inert")) {
            return false;
          }
        }

        return true;
      }) ?? null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (element) => {
        if (element.matches(selector)) matches.push(element);
        for (const child of element.children) visit(child);
      };
      for (const node of nodes) visit(node);
      return matches;
    }
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    /** Records the observer target and options for assertions. */
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }

  const window = {
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle(element) {
      return {
        display: "block",
        visibility: "visible",
        contentVisibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        position: "static",
        zIndex: "auto",
        cursor: "auto",
        ...element.computedStyle,
        ...(element.style.getPropertyValue("display")
          ? { display: element.style.getPropertyValue("display") }
          : {})
      };
    }
  };

  vm.runInNewContext(source, {
    document,
    window,
    location: { href: "https://anime3rb.com/episode/example" },
    URL,
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve({ ok: true });
        }
      }
    }
  });

  return {
    nodes,
    observer: observers[0],
    documentElement,
    messages,
    setElementFromPoint(element) {
      hitTestOverride = () => element;
    }
  };
}

/** Builds the anti-adblock modal structure supplied for this project. */
function createFullAntiAdblockModal() {
  const outer = new FakeElement({
    classes: ["fixed", "h-full", "bg-black/60", "overflow-auto", "z-50"],
    attributes: {
      "x-show": "isOpen",
      "x-on:zkqz0pik.window": "dynamic-event"
    }
  });

  const centeringWrapper = outer.append(new FakeElement({
    classes: ["w-full", "h-auto", "min-h-full", "flex", "justify-center"]
  }));

  const dialog = centeringWrapper.append(new FakeElement({
    classes: ["bg-white", "sm:max-w-lg"],
    attributes: { role: "dialog", "aria-labelledby": "modal-5" },
    text: "يرجى تعطيل مانع الإعلانات"
  }));

  dialog.rect = { width: 600, height: 400, top: 100, left: 200 };
  const header = dialog.append(new FakeElement({
    classes: ["relative", "flex", "flex-row-reverse"]
  }));
  header.append(new FakeElement({
    text: "يرجى تعطيل مانع الإعلانات"
  }));

  return { outer, centeringWrapper, dialog };
}

/** Creates a viewport-sized anchor with configurable overlay signals. */
function createOverlay({
  href = "https://hai8g.com/4/9023731",
  zIndex = "999",
  cursor = "default",
  width = 1000,
  height = 800
} = {}) {
  return new FakeElement({
    tagName: "a",
    href,
    rect: { width, height, top: 0, left: 0 },
    computedStyle: { position: "fixed", zIndex, cursor }
  });
}

test("hides the complete modal wrapper and dark backdrop from the supplied HTML", () => {
  const modal = createFullAntiAdblockModal();
  const harness = createHarness([modal.outer]);

  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].type, "kickmycard:hidden");
  assert.equal(harness.messages[0].target, "modal");
  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
  assert.equal(modal.outer.style.getPropertyPriority("display"), "important");
  assert.equal(modal.dialog.style.getPropertyValue("display"), "");
});

test("does not depend on the randomized Alpine window event name", () => {
  const modal = createFullAntiAdblockModal();
  modal.outer.attributes.set("x-on:another-random-id.window", "different-event");
  createHarness([modal.outer]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
});

test("leaves unrelated dialogs untouched", () => {
  const unrelated = new FakeElement({
    attributes: { role: "dialog" },
    text: "يرجى تعطيل الفيديو قبل المتابعة"
  });

  createHarness([unrelated]);
  assert.equal(unrelated.style.getPropertyValue("display"), "");
});

test("hides the supplied full-screen hai8g.com click overlay", () => {
  const overlay = createOverlay();
  const harness = createHarness([overlay]);

  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].type, "kickmycard:hidden");
  assert.equal(harness.messages[0].target, "overlay");
  assert.equal(overlay.style.getPropertyValue("display"), "none");
  assert.equal(overlay.style.getPropertyPriority("display"), "important");
});

test("detects the full-screen overlay signature when its host rotates", () => {
  const overlay = createOverlay({
    href: "https://rotating-ad.example/click",
    zIndex: "1000"
  });
  createHarness([overlay]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
});

test("does not hide ordinary links or partial-screen anchors", () => {
  const ordinaryLink = createOverlay({
    href: "https://example.com/watch",
    zIndex: "10",
    cursor: "pointer",
    width: 250,
    height: 100
  });
  createHarness([ordinaryLink]);

  assert.equal(ordinaryLink.style.getPropertyValue("display"), "");
});

test("detects an overlay inserted after page load", () => {
  const harness = createHarness();
  const overlay = createOverlay({ href: "https://rotating-ad.example/click" });

  harness.nodes.push(overlay);
  harness.observer.callback([{
    type: "childList",
    target: new FakeElement(),
    addedNodes: [overlay]
  }]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
});

test("detects the complete modal when inserted after page load", () => {
  const harness = createHarness();
  const modal = createFullAntiAdblockModal();

  harness.nodes.push(modal.outer);
  harness.observer.callback([{
    type: "childList",
    target: new FakeElement(),
    addedNodes: [modal.outer]
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
});

test("reinspects descendant anchors when an ancestor class changes", () => {
  const parent = new FakeElement();
  const overlay = createOverlay({
    href: "https://rotating-ad.example/click",
    zIndex: "0",
    cursor: "pointer"
  });
  parent.append(overlay);
  const harness = createHarness([parent]);

  assert.equal(overlay.style.getPropertyValue("display"), "");
  overlay.computedStyle = {
    position: "fixed",
    zIndex: "1000",
    cursor: "default"
  };

  harness.observer.callback([{
    type: "attributes",
    target: parent,
    attributeName: "class"
  }]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
});

test("rescans a dialog when its text node changes to the anti-adblock message", () => {
  const modal = createFullAntiAdblockModal();
  modal.dialog.textContent = "";
  const harness = createHarness([modal.outer]);
  const textNode = new FakeTextNode(modal.dialog);

  assert.equal(modal.outer.style.getPropertyValue("display"), "");
  modal.dialog.textContent = "يرجى تعطيل مانع الإعلانات";

  harness.observer.callback([{
    type: "characterData",
    target: textNode
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
});

test("rescans when an existing element receives role=dialog", () => {
  const modal = createFullAntiAdblockModal();
  modal.dialog.attributes.delete("role");
  const harness = createHarness([modal.outer]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "");
  modal.dialog.setAttribute("role", "dialog");

  harness.observer.callback([{
    type: "attributes",
    target: modal.dialog,
    attributeName: "role"
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
});

test("starts at document_start and observes Document before documentElement exists", () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL("../manifest.json", import.meta.url),
    "utf8"
  ));

  assert.equal(manifest.content_scripts[0].run_at, "document_start");

  const harness = createHarness([], null, { withoutDocumentElement: true });
  assert.equal(harness.documentElement, null);
  assert.equal(harness.observer.target, harness.document);

  const modal = createFullAntiAdblockModal();
  harness.nodes.push(modal.outer);
  harness.observer.callback([{
    type: "childList",
    target: harness.document,
    addedNodes: [modal.outer]
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 1);
});

test("registers the observer with the required subtree and mutation options", () => {
  const harness = createHarness();

  assert.equal(harness.observer.target, harness.document);
  assert.equal(harness.observer.options.subtree, true);
  assert.equal(harness.observer.options.childList, true);
  assert.equal(harness.observer.options.attributes, true);
  assert.equal(harness.observer.options.characterData, true);
  assert.deepEqual(
    [...harness.observer.options.attributeFilter],
    ["style", "href", "class", "role"]
  );
});


test("does not report the same element more than once while it stays hidden", () => {
  const modal = createFullAntiAdblockModal();
  const harness = createHarness([modal.outer]);

  harness.observer.callback([{
    type: "attributes",
    target: modal.outer,
    attributeName: "style"
  }]);

  assert.equal(harness.messages.length, 1);
});


test("does not modify or count a matching dialog while Alpine keeps it hidden", () => {
  const modal = createFullAntiAdblockModal();
  modal.outer.computedStyle = { display: "none" };
  const harness = createHarness([modal.outer]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "");
  assert.equal(modal.outer.attributes.get("aria-hidden"), undefined);
  assert.equal(harness.messages.length, 0);
});

test("counts a modal only when Alpine changes it from hidden to visible", () => {
  const modal = createFullAntiAdblockModal();
  modal.outer.computedStyle = { display: "none" };
  const harness = createHarness([modal.outer]);

  modal.outer.computedStyle.display = "block";
  harness.observer.callback([{
    type: "attributes",
    target: modal.outer,
    attributeName: "style"
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].target, "modal");
});

test("does not count a modal hidden by any ancestor", () => {
  const parent = new FakeElement({ computedStyle: { display: "none" } });
  const modal = createFullAntiAdblockModal();
  parent.append(modal.outer);
  const harness = createHarness([parent]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "");
  assert.equal(harness.messages.length, 0);
});

test("does not count a dialog that is transparent or outside the viewport", () => {
  const transparent = createFullAntiAdblockModal();
  transparent.outer.computedStyle = { opacity: "0" };
  const offscreen = createFullAntiAdblockModal();
  offscreen.outer.rect = {
    width: 1000, height: 800, top: 900, left: 0
  };
  const harness = createHarness([transparent.outer, offscreen.outer]);

  assert.equal(transparent.outer.style.getPropertyValue("display"), "");
  assert.equal(offscreen.outer.style.getPropertyValue("display"), "");
  assert.equal(harness.messages.length, 0);
});

test("does not count an overlay that is hidden or cannot receive pointer input", () => {
  const hidden = createOverlay();
  hidden.computedStyle.display = "none";
  const inert = createOverlay({ href: "https://hai8g.com/another-ad" });
  inert.computedStyle.pointerEvents = "none";
  const harness = createHarness([hidden, inert]);

  assert.equal(hidden.style.getPropertyValue("display"), "");
  assert.equal(inert.style.getPropertyValue("display"), "");
  assert.equal(harness.messages.length, 0);
});

test("counts an overlay only when it becomes visible and interactive", () => {
  const overlay = createOverlay();
  overlay.computedStyle.display = "none";
  overlay.computedStyle.pointerEvents = "none";
  const harness = createHarness([overlay]);

  assert.equal(harness.messages.length, 0);
  overlay.computedStyle.display = "block";
  overlay.computedStyle.pointerEvents = "auto";
  harness.observer.callback([{
    type: "attributes",
    target: overlay,
    attributeName: "style"
  }]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].target, "overlay");
});

test("counts a pointer-enabled overlay inside a pointer-events-none ancestor", () => {
  const parent = new FakeElement({
    computedStyle: { pointerEvents: "none" }
  });
  const overlay = createOverlay();
  overlay.computedStyle.pointerEvents = "auto";
  parent.append(overlay);
  const harness = createHarness([parent]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].target, "overlay");
});


test("does not count a click overlay inside an inert ancestor", () => {
  const parent = new FakeElement();
  parent.inert = true;
  const overlay = createOverlay();
  parent.append(overlay);
  const harness = createHarness([parent]);

  assert.equal(overlay.style.getPropertyValue("display"), "");
  assert.equal(harness.messages.length, 0);
});


test("does not count a fullscreen anchor that is behind another element", () => {
  const overlay = createOverlay();
  const coveringElement = new FakeElement();
  const harness = createHarness([overlay], coveringElement);

  assert.equal(overlay.style.getPropertyValue("display"), "");
  assert.equal(harness.messages.length, 0);
});


test("counts transparent click overlays when hit-testing proves they intercept input", () => {
  const overlay = createOverlay();
  overlay.computedStyle.opacity = "0";
  const harness = createHarness([overlay]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].target, "overlay");
});

test("rescans lower overlays after hiding the overlay above them", () => {
  const lowerOverlay = createOverlay({
    href: "https://hai8g.com/lower"
  });
  const upperOverlay = createOverlay({
    href: "https://hai8g.com/upper"
  });
  const harness = createHarness([lowerOverlay, upperOverlay]);

  assert.equal(lowerOverlay.style.getPropertyValue("display"), "none");
  assert.equal(upperOverlay.style.getPropertyValue("display"), "none");
  assert.equal(harness.messages.length, 2);
  assert.deepEqual(
    harness.messages.map((message) => message.target),
    ["overlay", "overlay"]
  );
});
