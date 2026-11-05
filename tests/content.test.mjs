import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../content.js", import.meta.url),
  "utf8"
);

const BACKDROP_SELECTOR = '[x-show="isOpen"][x-on\\:click="close"]';

class FakeStyle {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
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
    this.innerText = text;
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

    if (selector === BACKDROP_SELECTOR) {
      return (
        this.getAttribute("x-show") === "isOpen" &&
        this.getAttribute("x-on:click") === "close"
      );
    }

    if (selector === "a[href]") {
      return this.tagName === "A" && Boolean(this.href || this.getAttribute("href"));
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
  const body = new FakeElement({ tagName: "body" });
  const documentElement = new FakeElement({ tagName: "html" });

  const document = {
    body,
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
        top: "auto",
        left: "auto",
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

  return {
    nodes,
    body,
    observer: observers[0]
  };
}

function createAntiAdblockElements() {
  const shell = new FakeElement({
    classes: ["min-h-full", "justify-center"]
  });

  const dialog = new FakeElement({
    attributes: { role: "dialog" },
    text: "يرجى تعطيل مانع الإعلانات قم بتعطيل مانع الإعلاناااات !!!"
  });

  shell.append(dialog);

  const backdrop = new FakeElement({
    classes: ["fixed", "z-50"],
    attributes: {
      "x-show": "isOpen",
      "x-on:click": "close"
    }
  });

  return { shell, dialog, backdrop };
}

function createFullScreenOverlay({
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
    computedStyle: {
      position: "fixed",
      zIndex,
      cursor
    }
  });
}

test("hides the anti-adblock dialog shell and its matching backdrop", () => {
  const { shell, backdrop } = createAntiAdblockElements();
  createHarness([shell, shell.children[0], backdrop]);

  assert.equal(shell.style.getPropertyValue("display"), "none");
  assert.equal(shell.style.getPropertyPriority("display"), "important");
  assert.equal(backdrop.style.getPropertyValue("display"), "none");
});

test("does not hide unrelated dialogs or ordinary links", () => {
  const unrelatedDialog = new FakeElement({
    attributes: { role: "dialog" },
    text: "يرجى تعطيل الفيديو قبل المتابعة"
  });

  const ordinaryLink = createFullScreenOverlay({
    href: "https://example.com/watch",
    zIndex: "10",
    cursor: "pointer",
    width: 250,
    height: 100
  });

  createHarness([unrelatedDialog, ordinaryLink]);

  assert.equal(unrelatedDialog.style.getPropertyValue("display"), "");
  assert.equal(ordinaryLink.style.getPropertyValue("display"), "");
});

test("hides the supplied full-screen hai8g.com click overlay", () => {
  const overlay = createFullScreenOverlay();
  createHarness([overlay]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
  assert.equal(overlay.style.getPropertyPriority("display"), "important");
});

test("detects a full-screen overlay when its destination host changes", () => {
  const overlay = createFullScreenOverlay({
    href: "https://rotating-ad.example/click",
    zIndex: "1000",
    cursor: "default"
  });

  createHarness([overlay]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
});

test("detects matching overlays inserted after the initial page scan", () => {
  const harness = createHarness();
  const overlay = createFullScreenOverlay({
    href: "https://rotating-ad.example/click"
  });

  harness.nodes.push(overlay);
  harness.observer.callback([{
    type: "childList",
    target: harness.body,
    addedNodes: [overlay]
  }]);

  assert.equal(overlay.style.getPropertyValue("display"), "none");
});

test("detects anti-adblock dialogs inserted after the initial page scan", () => {
  const harness = createHarness();
  const { shell, dialog, backdrop } = createAntiAdblockElements();

  harness.nodes.push(shell, dialog, backdrop);
  harness.observer.callback([{
    type: "childList",
    target: harness.body,
    addedNodes: [shell, backdrop]
  }]);

  assert.equal(shell.style.getPropertyValue("display"), "none");
  assert.equal(backdrop.style.getPropertyValue("display"), "none");
});
