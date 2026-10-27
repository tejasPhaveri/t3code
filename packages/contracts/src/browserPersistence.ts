import * as Schema from "effect/Schema";
import { BrowserProfileId } from "./browserProfile.ts";

/**
 * Who owns a live browser tab: the chat that opened it (`thread`), every chat in its project
 * (`project`), or every project in the environment (`environment`). An isolated tab stays with
 * its chat in every mode.
 */
export const BrowserPersistence = Schema.Literals(["thread", "project", "environment"]);
export type BrowserPersistence = typeof BrowserPersistence.Type;

export const DEFAULT_BROWSER_PERSISTENCE: BrowserPersistence = "project";

export function isBrowserPersistence(value: string): value is BrowserPersistence {
  switch (value) {
    case "thread":
    case "project":
    case "environment":
      return true;
    default:
      return false;
  }
}

export interface PreviewScopeSession {
  readonly threadId: string;
  readonly projectId?: string | undefined;
  readonly persistence?: BrowserPersistence | undefined;
  readonly isolated?: boolean | undefined;
}

export interface PreviewScopeQuery {
  readonly threadId: string;
  readonly projectId?: string | undefined;
  readonly persistence?: BrowserPersistence | undefined;
}

/**
 * Whether `query` may see `session`. The query's persistence is the setting
 * in force now, so changing it retargets existing tabs. Isolation always wins.
 */
export function previewSessionVisibleTo(
  session: PreviewScopeSession,
  query: PreviewScopeQuery,
): boolean {
  if (session.isolated === true && session.threadId !== query.threadId) return false;
  const persistence = query.persistence ?? "thread";
  switch (persistence) {
    case "thread":
      return session.threadId === query.threadId;
    case "project":
      if (session.threadId === query.threadId) return true;
      return (
        query.projectId !== undefined &&
        session.projectId !== undefined &&
        session.projectId === query.projectId
      );
    case "environment":
      return true;
    default: {
      const _exhaustive: never = persistence;
      return _exhaustive;
    }
  }
}

export const BROWSER_PROJECT_TABS_MAX = 50;

/** One tab a project opens: which profile, at which page. */
export const BrowserProjectTab = Schema.Struct({
  profileId: BrowserProfileId,
  url: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2_048)),
});
export type BrowserProjectTab = typeof BrowserProjectTab.Type;

/**
 * The tabs a project is set up with, keyed by `scopedProjectKey`. Kept with the
 * client's browser profiles because profile ids only exist on this client.
 */
export const BrowserProjectSetup = Schema.Struct({
  tabs: Schema.Array(BrowserProjectTab).check(Schema.isMaxLength(BROWSER_PROJECT_TABS_MAX)),
  /** Open them when the project is first shown with no tabs saved from a previous run. */
  openAutomatically: Schema.Boolean,
});
export type BrowserProjectSetup = typeof BrowserProjectSetup.Type;
