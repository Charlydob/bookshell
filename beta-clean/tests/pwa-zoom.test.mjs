import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guardAnchor = html.indexOf("var isStandalone = false;");
assert.ok(guardAnchor > 0, "Standalone boot guard must exist");
const scriptStart = html.lastIndexOf("<script>", guardAnchor);
const scriptEnd = html.indexOf("</script>", guardAnchor);
assert.ok(scriptStart >= 0 && scriptEnd > guardAnchor, "Standalone guard must be in its own inline script");
const guardScript = html.slice(scriptStart + "<script>".length, scriptEnd);

function bootstrap({ standalone = false, iosStandalone = false } = {}) {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  const viewport = { setAttribute: (key, value) => attributes.set(key, value) };
  const document = {
    documentElement: { classList: { add: (name) => classes.add(name) } },
    querySelector: (selector) => selector === 'meta[name="viewport"]' ? viewport : null,
    addEventListener: (name, handler, options) => {
      listeners.set(name, { handler, options });
    },
  };
  const window = {
    matchMedia: () => ({ matches: standalone }),
    navigator: { standalone: iosStandalone },
  };
  runInNewContext(guardScript, { document, window });
  return { attributes, classes, listeners };
}

test("normal browser keeps accessible pinch zoom and no gesture interception", () => {
  assert.match(html, /content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  const app = bootstrap();
  assert.equal(app.attributes.size, 0);
  assert.equal(app.classes.size, 0);
  assert.equal(app.listeners.size, 0);
});

for (const mode of [
  { standalone: true, iosStandalone: false },
  { standalone: false, iosStandalone: true },
]) {
  test(`installed mode ${JSON.stringify(mode)} locks pinch zoom without blocking normal scrolling`, () => {
    const app = bootstrap(mode);
    assert.ok(app.classes.has("is-standalone"));
    const viewport = app.attributes.get("content") || "";
    assert.match(viewport, /maximum-scale=1/);
    assert.match(viewport, /user-scalable=no/);
    assert.match(viewport, /viewport-fit=cover/);
    assert.deepEqual([...app.listeners.keys()].sort(), ["gesturechange", "gesturestart"]);
    for (const name of ["gesturestart", "gesturechange"]) {
      const listener = app.listeners.get(name);
      assert.equal(listener.options.passive, false);
      assert.equal(listener.options.capture, true);
      let prevented = 0;
      listener.handler({ cancelable: true, preventDefault() { prevented += 1; } });
      listener.handler({ cancelable: false, preventDefault() { prevented += 1; } });
      assert.equal(prevented, 1, `${name} should prevent only cancellable pinch events`);
    }
    assert.match(html, /html\.is-standalone\s*\{\s*touch-action:\s*manipulation/);
    assert.equal(app.listeners.has("touchmove"), false, "One-finger scrolling must remain untouched");
  });
}
