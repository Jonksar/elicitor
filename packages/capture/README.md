# @elicitor/capture

Framework-free browser code for Elicitor's capture step. It dims the page and lets the user drag a
rectangle over the problem, then collects a screenshot, the text inside the rectangle, and a small
context object. The package ships no CSS file: the overlay injects one `<style data-elicitor-capture>`
element while it is open and removes it afterwards.

```ts
import {
  collectContext,
  createConsoleErrorBuffer,
  createRequestLog,
  startRegionSelect,
} from "@elicitor/capture";

const consoleErrors = createConsoleErrorBuffer();
const uninstall = consoleErrors.install(); // optional; call uninstall() to restore console.error
const requestLog = createRequestLog(); // optional; push your own request summaries

const capture = await startRegionSelect(); // null when the user cancelled
if (capture) {
  const context = collectContext({
    bundleId: "build-123",
    requestLog: requestLog.entries(),
    consoleErrors: consoleErrors.entries(),
  });
  // send capture.region, capture.screenshotPng, capture.regionText and context to your backend
}
```

## Marking a region

`startRegionSelect(options?)` puts a full-screen overlay (`role="dialog"`, `aria-modal`, labelled with
the hint text) over the page and focuses it.

- Drag: selects that rectangle. A drag with zero width or height is ignored.
- Enter, or the "Use whole view" button: selects the whole viewport (`region: null`).
- Escape, or the "Cancel" button, or aborting `options.signal`: resolves `null`.

The overlay, its listeners and its style element are removed before anything is captured, and focus
returns to the element that had it.

| Option          | Default                         | Effect                                                                   |
| --------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `labels`        | English                         | `{ hint, wholeView, cancel }`, any subset                                |
| `screenshot`    | `true`                          | `false`: `screenshotPng` is `""` and `modern-screenshot` is never loaded |
| `regionText`    | `true`                          | `false`: `regionText` is `[]`                                            |
| `maxRegionText` | `200`                           | maximum number of region text entries                                    |
| `zIndex`        | `var(--elicitor-z, 2147483000)` | overlay stacking order                                                   |
| `signal`        | none                            | aborting resolves `null`                                                 |

Lower-level pieces for custom UIs: `captureScreenshot(region)`, `collectRegionText(region, max)`.

### Theming

CSS variables, all optional: `--elicitor-accent` (buttons and rectangle, default `#dc2626`),
`--elicitor-overlay` (the dimming colour, default `rgba(15, 23, 42, 0.4)`), `--elicitor-z`. Elements
carry `data-elicitor-overlay`, `data-elicitor-hint`, `data-elicitor-whole-view`,
`data-elicitor-cancel` and `data-elicitor-region` for styling and tests.

### Keeping your own UI out of the capture

Any element with the `data-elicitor-ui` attribute, and everything inside it, is left out of both the
screenshot and the region text. The overlay sets it on itself; put it on your report button or panel.

## What is collected

Nothing is collected until the host calls these functions. Nothing is sent anywhere by this package:
it returns values for the host to send.

| Field                   | When it is collected                                                              | Cap                                                                                                                                              | How to disable                                      |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `region`                | after the user drags a rectangle (`null` for the whole view)                      | 6 numbers: `x`, `y`, `width`, `height`, `viewportWidth`, `viewportHeight` in CSS pixels                                                          | do not call `startRegionSelect`                     |
| `screenshotPng`         | after a region or the whole view is chosen, or when `captureScreenshot` is called | one PNG of the visible viewport at `min(devicePixelRatio, 2)` scale                                                                              | `screenshot: false`                                 |
| `regionText`            | at the same moment, or when `collectRegionText` is called                         | 200 unique entries (`maxRegionText`), each cut to 500 characters                                                                                 | `regionText: false`                                 |
| `context.language`      | when `collectContext` is called                                                   | one language tag: the `language` option, else `<html lang>`, else `navigator.language`                                                           | pass `language` yourself                            |
| `context.viewport`      | when `collectContext` is called                                                   | `window.innerWidth` and `window.innerHeight`                                                                                                     | not switchable                                      |
| `context.userAgent`     | when `collectContext` is called                                                   | `navigator.userAgent`                                                                                                                            | `userAgent: false` (sends `""`)                     |
| `context.bundleId`      | when `collectContext` is called                                                   | whatever the host passes; `""` by default                                                                                                        | omit `bundleId`                                     |
| `context.requestLog`    | only entries the host pushed into a `createRequestLog()` and passed in            | latest 50 entries (`createRequestLog(limit)`); fields `tag`, `startedAt`, `ms`, `outcome`, optional `errorTag`, `message` as the host wrote them | do not create or pass a request log                 |
| `context.consoleErrors` | only while a `createConsoleErrorBuffer()` is installed, and only if passed in     | latest 30 entries (`createConsoleErrorBuffer(limit)`); `message` and `stack` cut to 2000 characters each                                         | do not call `install()`, or do not pass the entries |

Details that matter for a privacy review:

- **The screenshot is the whole visible viewport, not the marked region.** A marked region is drawn
  as a red rectangle on the full picture; it does not crop it. Elements marked `data-elicitor-ui` are
  left out. Content scrolled out of view is not in the picture.
- **Region text** is the rendered text (`innerText`) of leaf elements whose box intersects the region,
  or the whole viewport when no region was marked. Text hidden with CSS (`display: none`) is skipped.
  It can contain whatever personal data is on screen.
- **Console errors** record the first argument of each `console.error` call (an `Error` gives its
  message and stack), `window` `error` events, and `unhandledrejection` reasons, with an ISO
  timestamp. Install is idempotent; the returned uninstall restores `console.error` (when nothing has
  wrapped it since) and removes the listeners.
- **Request log** entries are written by the host only. The package never observes network traffic.
  Call `clear()` when the signed-in user changes so one user's entries never reach another's report.

`modern-screenshot` is loaded with a dynamic `import()` the first time a screenshot is taken, so
bundlers split it into its own chunk and pages with screenshots off never download it.
