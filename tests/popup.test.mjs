import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../popup.js", import.meta.url),
  "utf8"
);

/**
 * Runs popup.js against a minimal document and controllable storage API.
 * @param {object|undefined} initial Initial persisted counters.
 * @returns {{elements: Map, emitChange: Function}} Popup test controls.
 */
function createHarness(initial = undefined) {
  const ids = ["total-count", "modal-count", "overlay-count", "footnote"];
  const elements = new Map(ids.map((id) => [id, { textContent: "" }]));
  let changeListener;

  const chrome = {
    storage: {
      local: {
        async get() {
          return { kickmycardStats: initial };
        }
      },
      onChanged: {
        addListener(listener) {
          changeListener = listener;
        }
      }
    }
  };

  vm.runInNewContext(source, {
    document: {
      getElementById(id) {
        return elements.get(id);
      }
    },
    chrome
  });

  return {
    elements,
    emitChange(stats) {
      changeListener({
        kickmycardStats: { newValue: stats }
      }, "local");
    }
  };
}

test("renders saved counters and their total", async () => {
  const harness = createHarness({ modal: 7, overlay: 3 });
  await new Promise((resolve) => setImmediate(resolve));

  const format = (value) => new Intl.NumberFormat("ar").format(value);
  assert.equal(harness.elements.get("modal-count").textContent, format(7));
  assert.equal(harness.elements.get("overlay-count").textContent, format(3));
  assert.equal(harness.elements.get("total-count").textContent, format(10));
});

test("updates the popup when stored statistics change", async () => {
  const harness = createHarness({ modal: 1, overlay: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  harness.emitChange({ modal: 4, overlay: 6 });

  const format = (value) => new Intl.NumberFormat("ar").format(value);
  assert.equal(harness.elements.get("modal-count").textContent, format(4));
  assert.equal(harness.elements.get("overlay-count").textContent, format(6));
  assert.equal(harness.elements.get("total-count").textContent, format(10));
});

test("starts at zero when no saved statistics exist", async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));

  const zero = new Intl.NumberFormat("ar").format(0);
  assert.equal(harness.elements.get("modal-count").textContent, zero);
  assert.equal(harness.elements.get("overlay-count").textContent, zero);
  assert.equal(harness.elements.get("total-count").textContent, zero);
});
