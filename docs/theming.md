# Theming

`@elicitor/react-ui` ships one stylesheet, `@elicitor/react-ui/styles.css`. Every rule is scoped
under `.elicitor` (each widget root) or `[data-elicitor-overlay]` (the region-select overlay), so
nothing in it touches your page. There is no CSS-in-JS and no UI library.

## Variables

Set any of these on `:root` or on an ancestor of the widget. All are optional.

| Variable               | Light default                                                            | Dark default                                                     | Used for                                    |
| ---------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------- |
| `--elicitor-fg`        | `#18181b`                                                                | `#ececf1`                                                        | text                                        |
| `--elicitor-bg`        | `#ffffff`                                                                | `#1c1c21`                                                        | panel and dialog background                 |
| `--elicitor-muted`     | `#5c5c66`                                                                | `#a5a5b0`                                                        | secondary text                              |
| `--elicitor-border`    | `#e3e3e8`                                                                | `#36363f`                                                        | borders and dividers                        |
| `--elicitor-accent`    | `#4338ca`                                                                | `#a5b4fc`                                                        | primary buttons, focus ring, highlights     |
| `--elicitor-accent-fg` | `#ffffff`                                                                | `#1e1b4b`                                                        | text on accent                              |
| `--elicitor-danger`    | `#b42318`                                                                | `#fda29b`                                                        | errors                                      |
| `--elicitor-radius`    | `12px`                                                                   | same                                                             | corner radius (small radii are 0.6 of it)   |
| `--elicitor-font`      | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`         | same                                                             | font family                                 |
| `--elicitor-shadow`    | `0 1px 2px rgb(16 16 24 / 0.06), 0 16px 40px -12px rgb(16 16 24 / 0.28)` | `0 1px 2px rgb(0 0 0 / 0.4), 0 20px 48px -12px rgb(0 0 0 / 0.7)` | floating button, dialog, panel              |
| `--elicitor-z`         | `2147483000`                                                             | same                                                             | stacking order of everything Elicitor shows |
| `--elicitor-overlay`   | `rgb(15 15 20 / 0.45)`                                                   | `rgb(0 0 0 / 0.6)`                                               | backdrop behind the sentence dialog         |

The success colour (`#15803d` light, `#86efac` dark) of the "sent" state is not a public variable.

```css
:root {
  --elicitor-accent: #0f766e;
  --elicitor-radius: 8px;
  --elicitor-font: "Inter", system-ui, sans-serif;
}
```

## Light, dark, system

Each component takes `colorScheme`: `"system"` (default) follows `prefers-color-scheme`; `"light"`
and `"dark"` force one, through the `data-elicitor-scheme` attribute on the widget root.

```tsx
<Elicitor colorScheme="dark" />
<ReportList colorScheme="dark" />
<ReportThread reportId={id} colorScheme="dark" />
```

A variable you set wins over **both** built-in palettes. To set different values per scheme, scope
them yourself:

```css
:root {
  --elicitor-accent: #0f766e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --elicitor-accent: #5eead4;
  }
}
/* or, for a forced scheme */
.elicitor[data-elicitor-scheme="dark"] {
  --elicitor-accent: #5eead4;
}
```

## The region-select overlay

The overlay comes from `@elicitor/capture`, which injects its own small `<style>` while it is open
and removes it afterwards. With the react-ui stylesheet loaded, the hint box and its buttons take the
widget's tokens and follow the system scheme (the overlay has no `colorScheme` prop). Two things
come from capture's own styles:

- the dimming colour is `var(--elicitor-overlay, rgba(15, 23, 42, 0.4))`, so `--elicitor-overlay`
  sets it too;
- the rectangle being drawn uses `var(--elicitor-accent, #dc2626)`: red unless you set
  `--elicitor-accent`.

The outline drawn into the screenshot is always red (`#dc2626`).

## Position, class names, motion

- `<Elicitor position="bottom-left" />`: `"bottom-right"` (default), `"bottom-left"`,
  `"top-right"`, `"top-left"`. It places the floating button and the thread panel.
- `className` on `Elicitor`, `ReportList`, `ReportThread` and `SummaryConfirm` is added to the root
  next to `elicitor`. Internal class names (`el-*`) are not a stable API; prefer the variables.
- Transitions and animations run only under `prefers-reduced-motion: no-preference`.
- Elements carry `data-elicitor-overlay`, `data-elicitor-hint`, `data-elicitor-whole-view`,
  `data-elicitor-cancel` and `data-elicitor-region` on the overlay, for styling and tests.

## Without react-ui

`@elicitor/capture` on its own needs no stylesheet. Its overlay reads `--elicitor-accent` (default
`#dc2626`), `--elicitor-overlay` (default `rgba(15, 23, 42, 0.4)`) and `--elicitor-z` (default
`2147483000`), and uses the system `Canvas` / `CanvasText` colours for the hint box. `@elicitor/react`
renders nothing visible.
