import type { Region } from "@elicitor/core";

/**
 * Elements carrying this attribute (or inside one that does) are left out of region text and
 * screenshots. The marking overlay sets it; UI packages set it on their own panels.
 */
export const UI_ATTRIBUTE = "data-elicitor-ui";

const MAX_ENTRY_LENGTH = 500;

const wholeViewport = (): Region => ({
  x: 0,
  y: 0,
  width: window.innerWidth,
  height: window.innerHeight,
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
});

/**
 * Text of visible leaf elements whose box intersects the region (the whole viewport when null).
 * Unique entries, each cut to 500 characters, at most `max` entries.
 */
export function collectRegionText(region: Region | null, max = 200): string[] {
  const box = region ?? wholeViewport();
  const entries = new Set<string>();
  if (max <= 0) return [];
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    if (element.children.length || element.closest(`[${UI_ATTRIBUTE}]`)) continue;
    const rect = element.getBoundingClientRect(),
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text only; hidden text must not leak into reports.
      text = element.innerText?.trim();
    if (
      text &&
      rect.width &&
      rect.height &&
      rect.right > box.x &&
      rect.left < box.x + box.width &&
      rect.bottom > box.y &&
      rect.top < box.y + box.height
    )
      entries.add(text.slice(0, MAX_ENTRY_LENGTH));
    if (entries.size >= max) break;
  }
  return [...entries];
}

/**
 * Renders the current viewport (scroll position and fixed elements included) to a PNG, leaving out
 * Elicitor UI. A region does not crop the picture: it is outlined with a red rectangle.
 * Returns base64 without the `data:` prefix. modern-screenshot is loaded on first use.
 */
export async function captureScreenshot(region: Region | null): Promise<string> {
  const { domToPng } = await import("modern-screenshot");
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const scrollX = window.scrollX,
    scrollY = window.scrollY;
  const png = await domToPng(document.documentElement, {
    ...viewport,
    scale,
    features: { restoreScrollPosition: true },
    style: { transformOrigin: "top left" },
    filter: (node) => !(node instanceof HTMLElement && node.hasAttribute(UI_ATTRIBUTE)),
    onCloneNode: (node) => {
      if (!(node instanceof HTMLElement)) return;
      for (const fixed of node.querySelectorAll<HTMLElement>("*")) {
        if (fixed.style.position === "fixed")
          fixed.style.transform = `translate(${scrollX}px, ${scrollY}px) ${fixed.style.transform === "none" ? "" : fixed.style.transform}`;
      }
    },
  });
  if (!region) return png.split(",")[1] ?? "";
  const image = new Image();
  image.src = png;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return png.split(",")[1] ?? "";
  context.drawImage(image, 0, 0);
  context.strokeStyle = "#dc2626";
  context.lineWidth = 2 * scale;
  context.strokeRect(
    region.x * scale,
    region.y * scale,
    region.width * scale,
    region.height * scale,
  );
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}
