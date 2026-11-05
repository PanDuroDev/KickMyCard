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
    rect = { width: 0, height: 0, top: 0, left: 0 },
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
function createHarness(initialNodes = []) {
  const nodes = [...initialNodes];
  const observers = [];
  const documentElement = new FakeElement({ tagName: "html" });

  const document = {
    documentElement,
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
        position: "static",
        zIndex: "auto",
        cursor: "auto",
        ...element.computedStyle
      };
    }
  };

  vm.runInNewContext(source, {
    document,
    window,
    location: { href: "https://anime3rb.com/episode/example" },
    URL,
    MutationObserver: FakeMutationObserver
  });

  return { nodes, observer: observers[0], documentElement };
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
  createHarness([modal.outer]);

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
  createHarness([overlay]);

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

test("registers the observer with the required subtree and mutation options", () => {
  const harness = createHarness();

  assert.equal(harness.observer.target, harness.documentElement);
  assert.equal(harness.observer.options.subtree, true);
  assert.equal(harness.observer.options.childList, true);
  assert.equal(harness.observer.options.attributes, true);
  assert.equal(harness.observer.options.characterData, true);
  assert.deepEqual(
    [...harness.observer.options.attributeFilter],
    ["style", "href", "class", "role"]
  );
});
