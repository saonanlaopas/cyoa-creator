import { renderToStaticMarkup } from "react-dom/server"; import { expect, test } from "vitest"; import { SettingsPage } from "../src/features/settings/SettingsPage.js";
test("renders write-only key input", () => expect(renderToStaticMarkup(<SettingsPage />)).toContain('type="password"'));
