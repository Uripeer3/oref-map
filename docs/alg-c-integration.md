# Alg-C Integration

## Goal

This document describes the intended browser integration for `alg-C` as a developer-only tool.

The objective is:

- expose a DevTools helper named `window.calcEllipseAlgC`
- keep the heavy `alg-C` code out of the normal startup path
- ensure regular users do not download or execute OpenCV/WASM code unless a developer explicitly requests it

## High-Level Design

The integration should be split into two layers.

### 1. Tiny bootstrap

A very small always-loaded bootstrap defines the global console helper:

```js
window.calcEllipseAlgC = async function(options) {
  const mod = await import('/ellipse-alg-c.js');
  return mod.calcEllipseAlgC(options || {});
};
```

This bootstrap is cheap:

- it does not import OpenCV
- it does not fetch WebAssembly
- it does not run any ellipse fitting

Its only job is to defer loading the real implementation until the helper is explicitly called from DevTools.

### 2. Heavy implementation module

The real implementation lives in:

- [`web/ellipse-alg-c.js`](/home/tomer/projects/oref-map/web/ellipse-alg-c.js)

That module should contain:

- the browser-side `alg-C` orchestration
- any `oref_points.json` resolution logic it needs
- optional debug rendering helpers
- the lazy import of the OpenCV-backed implementation

If a worker is used, it may also delegate the expensive part to:

- `web/ellipse-alg-c-worker.js`

## Why This Does Not Affect Regular Users

Regular users are unaffected as long as the heavy code stays behind the dynamic import.

In the intended design:

- `window.calcEllipseAlgC` exists, but does nothing until called
- `ellipse-alg-c.js` is not part of the normal startup path
- `@techstark/opencv-js` is not imported by the main application code
- OpenCV/WASM bytes are not downloaded on first page load
- no extra ellipse calculation runs during normal map usage

The normal ellipse feature in [`web/ellipse-mode.js`](/home/tomer/projects/oref-map/web/ellipse-mode.js) continues using its existing lightweight local geometry path.

This means the heavy `alg-C` path becomes opt-in and developer-triggered.

## What Must Be Avoided

The integration remains safe only if the following mistakes are avoided.

Do not:

- add a top-level `import '@techstark/opencv-js'` in [`web/ellipse-mode.js`](/home/tomer/projects/oref-map/web/ellipse-mode.js)
- add `ellipse-alg-c.js` as a regular startup `<script>` in [`web/index.html`](/home/tomer/projects/oref-map/web/index.html)
- move OpenCV initialization into code that runs during `app:ready`
- let the bundling setup fold `@techstark/opencv-js` into the main application chunk

Any of those would cause regular users to pay startup, download, parse, or memory cost even if they never use `alg-C`.

## Recommended Runtime Flow

The intended sequence is:

1. the app loads normally
2. the normal runtime initializes without OpenCV
3. a developer opens DevTools
4. the developer runs `window.calcEllipseAlgC(...)`
5. the browser dynamically imports `/ellipse-alg-c.js`
6. `ellipse-alg-c.js` loads any heavy dependencies on demand
7. the fit runs once for the current alert points
8. the result is returned and optionally rendered as a debug overlay

This keeps `alg-C` entirely outside the regular user journey.

## Recommended Console API

The public helper should be:

- `window.calcEllipseAlgC(options)`

Expected behavior:

- collect the current red-alert points from app state
- resolve coordinates from `oref_points.json` if needed
- run one `alg-C` fit for those points
- return the resulting ellipse data
- optionally draw a temporary debug overlay if requested in `options`

Suggested optional flags:

- `draw: true` to render the fitted ellipse on the map
- `log: true` to print intermediate metrics
- `worker: true` to force worker execution if supported

The exact option shape can stay small and evolve later.

## Worker Recommendation

Using a Web Worker is not required for correctness, but it is the safer implementation.

Reasons:

- OpenCV/WASM initialization can be slow on some devices
- running heavy code on the main thread can freeze the map briefly
- a worker keeps the UI responsive even when a developer triggers `alg-C`

Recommended split:

- [`web/ellipse-alg-c.js`](/home/tomer/projects/oref-map/web/ellipse-alg-c.js): public API, app-state gathering, overlay rendering, worker orchestration
- `web/ellipse-alg-c-worker.js`: OpenCV loading and actual fit

## Integration with Existing Ellipse Mode

[`web/ellipse-mode.js`](/home/tomer/projects/oref-map/web/ellipse-mode.js) already exposes developer helpers such as:

- `window.printEllipsesInfos`
- `window.editEllipse`

`window.calcEllipseAlgC` should follow the same spirit:

- easy to invoke from DevTools
- not part of the normal UI
- isolated from standard user-facing rendering

There is no need to replace the existing base ellipse mode with `alg-C`.

The intended role of `alg-C` in the browser is:

- developer diagnostics
- one-off comparison against the built-in browser ellipse logic
- investigation of specific alert sets

## Performance Summary

With the lazy-loading design, the cost profile is:

- regular users: essentially zero additional runtime cost
- developers who call the helper once: one-time module download, OpenCV/WASM initialization, one ellipse fit

That is a good tradeoff for a DevTools-only feature.

## Implementation Rule

The integration is safe if this rule is followed:

`@techstark/opencv-js` must only be reachable from code that is loaded after `window.calcEllipseAlgC()` is explicitly called.

If that rule holds, normal users will not be affected in practice.
