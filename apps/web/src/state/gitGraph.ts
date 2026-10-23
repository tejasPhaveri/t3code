import { createGitGraphEnvironmentAtoms } from "@t3tools/client-runtime/state/git-graph";

import { connectionAtomRuntime } from "../connection/runtime";

export const gitGraphEnvironment = createGitGraphEnvironmentAtoms(connectionAtomRuntime);
