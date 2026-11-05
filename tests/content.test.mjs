import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../content.js", import.meta.url),
  "utf8"
);

class FakeStyle {
  constructor() {
    this.values = new Map();
    this.priorities = new Map();
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }

  getPropertyPriority(name) {
    return this.priorities.get(name) || "";
  }

  setProperty(name, value, priority = "") {
    this.values.set(name, value);
    this.priorities.set(name, priority);
  }
}

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  contains(value) {
    return this.values.has(value);
  }
}

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

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

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

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

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

  getBoundingClientRect() {
    return this.rect;
  }
}

function createHarness(initialNodes = []) {
  const nodes = [...initialNodes];
  const observers = [];
  const documentElement = new FakeElement({ tagName: "html" });

  const document = {
    documentElement,
    querySelectorAll(selector) {
      return nodes.filter((node) => node.matches(selector));
    }
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
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

  return { nodes, observer: observers[0] };
}

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
  createHarness([modal.outer, modal.dialog]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
  assert.equal(modal.outer.style.getPropertyPriority("display"), "important");
  assert.equal(modal.dialog.style.getPropertyValue("display"), "");
});

test("does not depend on the randomized Alpine window event name", () => {
  const modal = createFullAntiAdblockModal();
  modal.outer.attributes.set("x-on:another-random-id.window", "different-event");
  createHarness([modal.outer, modal.dialog]);

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

  harness.nodes.push(modal.outer, modal.dialog);
  harness.observer.callback([{
    type: "childList",
    target: new FakeElement(),
    addedNodes: [modal.outer]
  }]);

  assert.equal(modal.outer.style.getPropertyValue("display"), "none");
});
