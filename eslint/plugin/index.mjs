// Project-specific lint rules for the structure in docs/ARCHITECTURE.md that
// no published plugin covers.
import fileStructure from "./rules/file-structure.mjs";
import noServerImportInClient from "./rules/no-server-import-in-client.mjs";
import requireServerOnly from "./rules/require-server-only.mjs";
import useServerLocation from "./rules/use-server-location.mjs";

const plugin = {
  meta: { name: "project" },
  rules: {
    "file-structure": fileStructure,
    "no-server-import-in-client": noServerImportInClient,
    "require-server-only": requireServerOnly,
    "use-server-location": useServerLocation,
  },
};

export default plugin;
