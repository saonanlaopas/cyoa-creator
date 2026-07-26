import { renderToStaticMarkup } from "react-dom/server"; import { expect, test } from "vitest"; import { StudioLayout } from "../src/features/studio/StudioLayout.js";
test("renders three-pane studio navigation", () => expect(renderToStaticMarkup(<StudioLayout />)).toContain("Pipeline"));
