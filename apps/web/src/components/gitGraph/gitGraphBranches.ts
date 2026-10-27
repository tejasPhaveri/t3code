import type { GitGraphRef } from "@t3tools/contracts";

export interface BranchFilterOption {
  /** Full ref name, which is what `git log` takes. */
  readonly fullName: string;
  /** `main`, `origin/main`, `v1`. */
  readonly name: string;
  readonly kind: GitGraphRef["kind"];
  /** The remote's name for a remote branch, for grouping. */
  readonly remote: string | null;
  readonly checkedOut: boolean;
}

/**
 * Git Graph's Branches dropdown. A custom glob pattern matches against `fullName` without its
 * `refs/heads/` or `refs/remotes/` prefix, so `feature/*` reads the way a reader types it.
 */
export function branchFilterOptions(
  refs: readonly GitGraphRef[],
  checkedOutBranch: string | null,
): BranchFilterOption[] {
  return refs
    .filter((ref) => ref.kind !== "tag")
    .map((ref) => ({
      fullName: ref.fullName,
      name: ref.name,
      kind: ref.kind,
      remote: ref.kind === "remote" ? (ref.name.split("/")[0] ?? null) : null,
      checkedOut: ref.kind === "head" && ref.name === checkedOutBranch,
    }))
    .toSorted((left, right) => {
      if (left.checkedOut !== right.checkedOut)
        return Number(right.checkedOut) - Number(left.checkedOut);
      if (left.kind !== right.kind) return left.kind === "head" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

/** The `refs/heads/` and `refs/remotes/` prefixes a glob pattern is matched without. */
const GLOB_PREFIXES = ["refs/heads/", "refs/remotes/"] as const;

export function refMatchesGlob(fullName: string, glob: string): boolean {
  const prefix = GLOB_PREFIXES.find((candidate) => fullName.startsWith(candidate));
  const shortName = prefix === undefined ? fullName : fullName.slice(prefix.length);
  return globToRegExp(glob).test(shortName);
}

/**
 * A glob as Git Graph's patterns mean it: `*` within a path segment, `**` across them, `?` for
 * one character. Everything else is literal, so a pattern cannot become a regex by accident.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export interface BranchFilterState {
  /** `all` shows every branch; `selected` shows only the checked refs; `glob` uses a pattern. */
  readonly mode: "all" | "selected" | "glob";
  readonly selected: readonly string[];
  readonly glob: string;
}

export const DEFAULT_BRANCH_FILTER: BranchFilterState = { mode: "all", selected: [], glob: "" };

/** The ref names to hand to the log query, or undefined when everything is shown. */
export function branchFilterRefs(
  filter: BranchFilterState,
  options: readonly BranchFilterOption[],
): readonly string[] | undefined {
  if (filter.mode === "glob") {
    const pattern = filter.glob.trim();
    if (pattern.length === 0) return undefined;
    const matches = options.filter((option) => refMatchesGlob(option.fullName, pattern));
    return matches.length === 0 ? [] : matches.map((option) => option.fullName);
  }
  if (filter.mode === "selected") {
    const known = new Set(options.map((option) => option.fullName));
    return filter.selected.filter((ref) => known.has(ref));
  }
  return undefined;
}

export function describeBranchFilter(
  filter: BranchFilterState,
  options: readonly BranchFilterOption[],
): string {
  if (filter.mode === "glob") {
    return filter.glob.trim().length === 0 ? "All branches" : `Glob: ${filter.glob.trim()}`;
  }
  if (filter.mode === "selected") {
    const refs = branchFilterRefs(filter, options) ?? [];
    return refs.length === 0 ? "No branches" : `${refs.length} branches`;
  }
  return "All branches";
}
