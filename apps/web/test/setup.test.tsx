import { renderToStaticMarkup } from "react-dom/server"; import { expect, test } from "vitest"; import { SetupWizard } from "../src/features/setup/SetupWizard.js"; import { demoProject } from "../src/api/client.js";
test("renders guided setup defaults", () => expect(renderToStaticMarkup(<SetupWizard project={demoProject} complete={() => {}} />)).toContain("Import story"));
