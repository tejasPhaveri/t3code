export type RankedSearchResult<T> = {
  item: T;
  score: number;
  tieBreaker: string;
};

export function normalizeSearchQuery(
  input: string,
  options?: {
    trimLeadingPattern?: RegExp;
  },
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return options?.trimLeadingPattern
    ? trimmed.replace(options.trimLeadingPattern, "").toLowerCase()
    : trimmed.toLowerCase();
}

export function scoreSubsequenceMatch(
  value: string,
  query: string,
  options?: { ignorePosition?: boolean },
): number | null {
  if (!query) return 0;

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -1;
  let gapPenalty = 0;

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex;
    }
    if (previousMatchIndex !== -1) {
      gapPenalty += valueIndex - previousMatchIndex - 1;
    }

    previousMatchIndex = valueIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length;
      if (options?.ignorePosition) {
        return gapPenalty * 3 + spanPenalty;
      }
      const lengthPenalty = Math.min(64, value.length - query.length);
      return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
    }
  }

  return null;
}

function lengthPenalty(value: string, query: string): number {
  return Math.min(64, Math.max(0, value.length - query.length));
}

function findBoundaryMatchIndex(
  value: string,
  query: string,
  boundaryMarkers: readonly string[],
): number | null {
  let bestIndex: number | null = null;

  for (const marker of boundaryMarkers) {
    const index = value.indexOf(`${marker}${query}`);
    if (index === -1) {
      continue;
    }

    const matchIndex = index + marker.length;
    if (bestIndex === null || matchIndex < bestIndex) {
      bestIndex = matchIndex;
    }
  }

  return bestIndex;
}

/** value and query must already be trimmed and lowercased. */
export function scoreQueryMatch(input: {
  value: string;
  query: string;
  exactBase: number;
  prefixBase?: number;
  boundaryBase?: number;
  includesBase?: number;
  fuzzyBase?: number;
  boundaryMarkers?: readonly string[];
  ignorePosition?: boolean;
}): number | null {
  const { value, query } = input;
  const ignorePosition = input.ignorePosition === true;
  const penalty = ignorePosition ? 0 : lengthPenalty(value, query);

  if (!value || !query) {
    return null;
  }

  if (value === query) {
    return input.exactBase;
  }

  if (input.prefixBase !== undefined && value.startsWith(query)) {
    return input.prefixBase + penalty;
  }

  if (input.boundaryBase !== undefined) {
    const boundaryIndex = findBoundaryMatchIndex(
      value,
      query,
      input.boundaryMarkers ?? [" ", "-", "_", "/"],
    );
    if (boundaryIndex !== null) {
      return input.boundaryBase + (ignorePosition ? 0 : boundaryIndex * 2) + penalty;
    }
  }

  if (input.includesBase !== undefined) {
    const includesIndex = value.indexOf(query);
    if (includesIndex !== -1) {
      return input.includesBase + (ignorePosition ? 0 : includesIndex * 2) + penalty;
    }
  }

  if (input.fuzzyBase !== undefined) {
    const fuzzyScore = scoreSubsequenceMatch(value, query, { ignorePosition });
    if (fuzzyScore !== null) {
      return input.fuzzyBase + fuzzyScore;
    }
  }

  return null;
}

function compareRankedSearchResults<T>(
  left: RankedSearchResult<T>,
  right: RankedSearchResult<T>,
): number {
  const scoreDelta = left.score - right.score;
  if (scoreDelta !== 0) return scoreDelta;
  return left.tieBreaker.localeCompare(right.tieBreaker);
}

function findInsertionIndex<T>(
  rankedEntries: RankedSearchResult<T>[],
  candidate: RankedSearchResult<T>,
): number {
  let low = 0;
  let high = rankedEntries.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const current = rankedEntries[middle];
    if (!current) {
      break;
    }

    if (compareRankedSearchResults(candidate, current) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

const AGENT_SKILL_DIRECTORY_NAMES = new Set([".agents", ".agent", "skills"]);

/** Queries that still find skill files after frecency has ranked them out of the page. */
export const AGENT_SKILL_PATH_SEED_QUERIES = [".agents", ".agent", "skills", "SKILL.md"] as const;

function pathSegments(path: string): string[] {
  return path.split(/[/\\]+/).filter((segment) => segment.length > 0);
}

function isAgentSkillDirectory(segment: string): boolean {
  const name = segment.toLowerCase();
  return AGENT_SKILL_DIRECTORY_NAMES.has(name) || name.startsWith("skills-");
}

export function isAgentSkillPath(path: string): boolean {
  const segments = pathSegments(path);
  const fileName = segments.at(-1)?.toLowerCase();
  if (fileName === "skill.md") return true;
  return segments.some(isAgentSkillDirectory);
}

export function prefersAgentSkillPaths(query: string): boolean {
  if (query.length === 0) return true;
  const normalized = query.toLowerCase().replace(/^\.+/, "");
  if (normalized.length < 2) return false;
  return ["agents", "agent", "skills", "skill"].some(
    (token) => token.startsWith(normalized) || normalized.startsWith(token),
  );
}

export function orderAgentSkillPathsFirst<T extends { readonly path: string }>(
  entries: ReadonlyArray<T>,
): T[] {
  const skillPaths: T[] = [];
  const otherPaths: T[] = [];
  for (const entry of entries) {
    if (isAgentSkillPath(entry.path)) skillPaths.push(entry);
    else otherPaths.push(entry);
  }
  return skillPaths.length === 0 ? [...entries] : [...skillPaths, ...otherPaths];
}

export function insertRankedSearchResult<T>(
  rankedEntries: RankedSearchResult<T>[],
  candidate: RankedSearchResult<T>,
  limit: number,
): void {
  if (limit <= 0) {
    return;
  }

  const insertionIndex = findInsertionIndex(rankedEntries, candidate);
  if (rankedEntries.length < limit) {
    rankedEntries.splice(insertionIndex, 0, candidate);
    return;
  }

  if (insertionIndex >= limit) {
    return;
  }

  rankedEntries.splice(insertionIndex, 0, candidate);
  rankedEntries.pop();
}
