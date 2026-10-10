// Project-specific lint rules for the structure in docs/ARCHITECTURE.md that
// no published plugin covers.
import fileStructure from "./rules/file-structure.mjs";
import noServerImportInClient from "./rules/no-server-import-in-client.mjs";
import requireServerOnly from "./rules/require-server-only.mjs";
import serverActionAuth from "./rules/server-action-auth.mjs";
import serverActionValidation from "./rules/server-action-validation.mjs";
import useServerLocation from "./rules/use-server-location.mjs";

const plugin = {
  meta: { name: "project" },
  rules: {
    "file-structure": fileStructure,
    "no-server-import-in-client": noServerImportInClient,
    "require-server-only": requireServerOnly,
    "server-action-auth": serverActionAuth,
    "server-action-validation": serverActionValidation,
    "use-server-location": useServerLocation,
  },
};

export default plugin;
