import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SetupWizard } from "../src/features/setup/SetupWizard.js";
import { StudioLayout } from "../src/features/studio/StudioLayout.js";
import { PlayPreview } from "../src/features/play/PlayPreview.js";
import { demoProject } from "../src/api/client.js";

test("renders setup, studio, and playable preview shells", () => {
  expect(renderToStaticMarkup(createElement(SetupWizard, { project: demoProject, complete: () => {} }))).toContain("Import story");
  expect(renderToStaticMarkup(createElement(StudioLayout))).toContain("Pipeline");
  expect(renderToStaticMarkup(createElement(PlayPreview))).toContain("Continue");
});
