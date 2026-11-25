import type { Region } from "@elicitor/capture";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

const Box = ({ region }: { region: Region }) => <p>{`${region.width}x${region.height}`}</p>;

test("renders a component in the browser", async () => {
  const screen = await render(
    <Box region={{ x: 0, y: 0, width: 4, height: 3, viewportWidth: 10, viewportHeight: 10 }} />,
  );
  await expect.element(screen.getByText("4x3")).toBeVisible();
});
