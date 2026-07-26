import { renderToStaticMarkup } from "react-dom/server"; import { expect, test } from "vitest"; import { PlayPreview } from "../src/features/play/PlayPreview.js";
test("renders playable preview with gated choice", () => expect(renderToStaticMarkup(<PlayPreview />)).toContain("Locked"));
