import { renderToStaticMarkup } from "react-dom/server"; import { expect, test } from "vitest"; import { FindingsPanel } from "../src/features/playtest/FindingsPanel.js";
test("renders targeted repair entry point", () => expect(renderToStaticMarkup(<FindingsPanel />)).toContain("Request repair"));
