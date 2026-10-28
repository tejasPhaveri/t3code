import { createCloudAgentsEnvironmentAtoms } from "@t3tools/client-runtime/state/cloud-agents";

import { connectionAtomRuntime } from "../connection/runtime";

export const cloudAgentsEnvironment = createCloudAgentsEnvironmentAtoms(connectionAtomRuntime);
