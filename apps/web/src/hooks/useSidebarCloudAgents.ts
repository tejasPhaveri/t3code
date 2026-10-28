import type { CloudAgent, EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";

import { getClientSettings, subscribeClientSettings } from "~/hooks/useSettings";
import { cloudAgentsEnvironment } from "~/state/cloudAgents";
import { environmentPresentations } from "~/state/presentation";

export interface SidebarCloudAgentRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly agent: CloudAgent;
}

const EMPTY_ROWS: ReadonlyArray<SidebarCloudAgentRow> = [];

function collectRows(get: Atom.AtomContext): ReadonlyArray<SidebarCloudAgentRow> {
  const rows: SidebarCloudAgentRow[] = [];
  for (const environmentId of get(environmentPresentations.serverConfigsAtom).keys()) {
    const result = get(cloudAgentsEnvironment.list({ environmentId, input: {} }));
    const page = Option.getOrNull(AsyncResult.value(result));
    if (page === null) continue;
    for (const agent of page.agents) {
      rows.push({ key: `${environmentId}:${agent.id}`, environmentId, agent });
    }
  }
  return rows;
}

/**
 * Cloud agents from every connected environment, ordered the way each server ranks
 * them: work in flight first, then most recently active.
 *
 * Nothing polls while the shelf is hidden, which is the default: the atom reads no
 * cloud query at all until the setting turns it on.
 */
const sidebarCloudAgentRowsAtom = Atom.readable(
  (get) => (getClientSettings().sidebarCloudAgentsVisible ? collectRows(get) : EMPTY_ROWS),
  (refresh) => subscribeClientSettings(() => refresh(sidebarCloudAgentRowsAtom)),
).pipe(Atom.withLabel("sidebar-cloud-agent-rows"));

export function useSidebarCloudAgentRows(): ReadonlyArray<SidebarCloudAgentRow> {
  return useAtomValue(sidebarCloudAgentRowsAtom);
}
