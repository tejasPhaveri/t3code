import type { GitGraphWorktreeFile } from "@t3tools/contracts";

export interface FileTreeNode {
  /** Display name; a compacted folder chain reads `src/server`. */
  readonly name: string;
  /** Stable key: the folder path or the file path. */
  readonly key: string;
  readonly file: GitGraphWorktreeFile | null;
  readonly children: readonly FileTreeNode[];
  /** Every file at or under this node, for folder-wide actions. */
  readonly filePaths: readonly string[];
}

interface MutableFolder {
  readonly folders: Map<string, MutableFolder>;
  readonly files: GitGraphWorktreeFile[];
}

const emptyFolder = (): MutableFolder => ({ folders: new Map(), files: [] });
const byName = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true });

function toNodes(folder: MutableFolder, prefix: string): FileTreeNode[] {
  const folders = [...folder.folders.entries()]
    .toSorted(([left], [right]) => byName(left, right))
    .map(([name, child]) => {
      let displayName = name;
      let path = `${prefix}${name}`;
      let current = child;
      // VS Code-style compact folders: a folder holding only one folder reads as one row.
      while (current.files.length === 0 && current.folders.size === 1) {
        const [onlyName, only] = [...current.folders.entries()][0]!;
        displayName = `${displayName}/${onlyName}`;
        path = `${path}/${onlyName}`;
        current = only;
      }
      const children = toNodes(current, `${path}/`);
      return {
        name: displayName,
        key: `${path}/`,
        file: null,
        children,
        filePaths: children.flatMap((node) => node.filePaths),
      };
    });
  const files = folder.files
    .toSorted((left, right) => byName(left.path, right.path))
    .map((file) => ({
      name: file.path.slice(prefix.length),
      key: file.path,
      file,
      children: [],
      filePaths: [file.path],
    }));
  return [...folders, ...files];
}

export function buildFileTree(files: readonly GitGraphWorktreeFile[]): FileTreeNode[] {
  const root = emptyFolder();
  for (const file of files) {
    const segments = file.path.split("/");
    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = emptyFolder();
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  return toNodes(root, "");
}
