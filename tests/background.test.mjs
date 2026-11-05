import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../background.js", import.meta.url),
  "utf8"
);

/**
 * Runs the service worker with an in-memory Chrome storage implementation.
 * @param {object} initial Initial value for the statistics storage key.
 * @returns {{send: Function, read: Function}} Message and storage test helpers.
 */
function createHarness(initial = undefined) {
  const data = { kickmycardStats: initial };
  let messageListener;

  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: data[key] };
        },
        async set(values) {
          Object.assign(data, values);
        }
      }
    }
  };

  vm.runInNewContext(source, { chrome, console });

  return {
    send(message) {
      return new Promise((resolve) => {
        const keepAlive = messageListener(message, {}, resolve);
        if (keepAlive !== true) resolve({ ignored: true });
      });
    },
    read() {
      return data.kickmycardStats;
    }
  };
}

test("increments modal and click-overlay counters independently", async () => {
  const harness = createHarness();

  const results = await Promise.all([
    harness.send({ type: "kickmycard:hidden", target: "modal" }),
    harness.send({ type: "kickmycard:hidden", target: "overlay" }),
    harness.send({ type: "kickmycard:hidden", target: "modal" })
  ]);

  assert.ok(results.every((result) => result.ok));
  assert.equal(harness.read().modal, 2);
  assert.equal(harness.read().overlay, 1);
});

test("ignores unrelated messages and unknown counter types", async () => {
  const harness = createHarness();

  const unknownMessage = await harness.send({ type: "other:event", target: "modal" });
  const unknownTarget = await harness.send({
    type: "kickmycard:hidden",
    target: "video"
  });

  assert.equal(unknownMessage.ignored, true);
  assert.equal(unknownTarget.ignored, true);
  assert.equal(harness.read(), undefined);
});

test("repairs invalid stored counter values before incrementing", async () => {
  const harness = createHarness({ modal: -4, overlay: "bad" });

  await harness.send({ type: "kickmycard:hidden", target: "overlay" });

  assert.equal(harness.read().modal, 0);
  assert.equal(harness.read().overlay, 1);
});
