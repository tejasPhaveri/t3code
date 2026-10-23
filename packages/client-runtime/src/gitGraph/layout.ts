export interface GitGraphLayoutCommit {
  readonly hash: string;
  readonly parents: readonly string[];
}

/** A line from a lane at one row's node level to a lane at the next row's node level. */
export interface GitGraphSegment {
  readonly from: number;
  readonly to: number;
  /** Index into the renderer's palette; a branch line keeps one color down its first parents. */
  readonly color: number;
}

export interface GitGraphRow {
  readonly column: number;
  readonly color: number;
  readonly below: readonly GitGraphSegment[];
}

export interface GitGraphLayout {
  readonly rows: readonly GitGraphRow[];
  /** Widest lane count across all rows, so the graph column does not jump while scrolling. */
  readonly laneCount: number;
}

interface Lane {
  readonly hash: string;
  readonly color: number;
}

const firstFreeLane = (lanes: ReadonlyArray<Lane | null>): number => {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
};

const laneExpecting = (lanes: ReadonlyArray<Lane | null>, hash: string): number =>
  lanes.findIndex((lane) => lane?.hash === hash);

/**
 * Assigns each commit (in log order, children before parents) a lane, and the
 * lines joining it to the rows below. Lanes keep their position while open so
 * long-lived branches stay put; a freed lane is reused by the next new line.
 */
export function layoutGitGraph(commits: readonly GitGraphLayoutCommit[]): GitGraphLayout {
  const lanes: Array<Lane | null> = [];
  const rows: GitGraphRow[] = [];
  let nextColor = 0;
  let laneCount = 0;

  for (const [index, commit] of commits.entries()) {
    let column = laneExpecting(lanes, commit.hash);
    let color: number;
    if (column === -1) {
      column = firstFreeLane(lanes);
      color = nextColor++;
    } else {
      color = lanes[column]!.color;
    }
    for (const [lane, expected] of lanes.entries()) {
      if (lane !== column && expected?.hash === commit.hash) lanes[lane] = null;
    }

    const [firstParent, ...mergeParents] = commit.parents;
    lanes[column] = firstParent === undefined ? null : { hash: firstParent, color };
    // Lanes opened at this node start their line at the node, not straight above.
    const origins = new Map<number, number[]>();
    for (const parent of mergeParents) {
      let lane = laneExpecting(lanes, parent);
      if (lane === -1) {
        lane = firstFreeLane(lanes);
        lanes[lane] = { hash: parent, color: nextColor++ };
        origins.set(lane, [column]);
      } else {
        origins.set(lane, [...(origins.get(lane) ?? [lane]), column]);
      }
    }
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop();
    laneCount = Math.max(laneCount, lanes.length, column + 1);

    const next = commits[index + 1];
    const nextColumn = next === undefined ? -1 : laneExpecting(lanes, next.hash);
    const below: GitGraphSegment[] = [];
    for (const [lane, expected] of lanes.entries()) {
      if (expected === null) continue;
      const to = next !== undefined && expected.hash === next.hash ? nextColumn : lane;
      for (const from of origins.get(lane) ?? [lane]) {
        below.push({ from, to, color: expected.color });
      }
    }
    rows.push({ column, color, below });
  }

  return { rows, laneCount };
}
