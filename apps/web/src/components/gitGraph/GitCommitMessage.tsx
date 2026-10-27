import { replaceEmojiShortcodes } from "./gitGraphFormat";

/**
 * Git Graph renders a subset of inline Markdown in commit messages (`**bold**`, `_italic_`,
 * `\`code\``) plus issue links and emoji shortcodes. Doing it here keeps the message a text
 * node rather than HTML, so a message can never inject markup.
 */
type MessageToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

const ISSUE_PATTERN = /(?:([\w.-]+\/[\w.-]+)#(\d+)|#(\d+))\b/g;
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

/** Only a relative issue link is turned into an href; the caller supplies the repository URL. */
function issueHref(repo: string | null, number: string, host: string | null): string | null {
  if (host === null) return null;
  return repo === null ? `${host}/issues/${number}` : `${host}/${repo}/issues/${number}`;
}

function linkifyText(text: string, host: string | null): MessageToken[] {
  const tokens: MessageToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(ISSUE_PATTERN)) {
    const index = match.index;
    if (index === undefined) continue;
    const [whole, repo, crossNumber, localNumber] = match;
    const number = crossNumber ?? localNumber;
    if (number === undefined) continue;
    if (index > cursor) tokens.push({ kind: "text", text: text.slice(cursor, index) });
    const href = issueHref(crossNumber !== undefined ? (repo ?? null) : null, number, host);
    tokens.push(
      href === null ? { kind: "text", text: whole } : { kind: "link", text: whole, href },
    );
    cursor = index + whole.length;
  }
  if (cursor < text.length) tokens.push({ kind: "text", text: text.slice(cursor) });
  return tokens;
}

/** Splits one line into inline formatting, then linkifies the plain runs. */
function tokenizeLine(line: string, host: string | null): MessageToken[] {
  const tokens: MessageToken[] = [];
  let cursor = 0;
  for (const match of line.matchAll(INLINE_PATTERN)) {
    const index = match.index;
    if (index === undefined) continue;
    if (index > cursor) tokens.push(...linkifyText(line.slice(cursor, index), host));
    const raw = match[0]!;
    const inner = raw.slice(2, -2);
    if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ kind: "strong", text: inner });
    } else if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else {
      tokens.push({ kind: "emphasis", text: raw.slice(1, -1) });
    }
    cursor = index + raw.length;
  }
  if (cursor < line.length) tokens.push(...linkifyText(line.slice(cursor), host));
  return tokens;
}

function renderTokens(tokens: readonly MessageToken[], keyPrefix: string) {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}:${index}`;
    switch (token.kind) {
      case "text":
        return <span key={key}>{token.text}</span>;
      case "strong":
        return (
          <strong key={key} className="font-semibold text-foreground">
            {token.text}
          </strong>
        );
      case "emphasis":
        return (
          <em key={key} className="italic">
            {token.text}
          </em>
        );
      case "code":
        return (
          <code key={key} className="rounded-sm bg-muted px-1 font-mono text-2xs">
            {token.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer"
            className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
            onClick={(event) => event.stopPropagation()}
          >
            {token.text}
          </a>
        );
    }
  });
}

/**
 * A commit message as Git Graph shows it: emoji shortcodes, issue links into the repository on
 * its host, and the inline formatting above. Blank lines become paragraph breaks.
 */
export function GitCommitMessage(props: {
  readonly message: string;
  readonly host: string | null;
  readonly className?: string;
}) {
  const expanded = replaceEmojiShortcodes(props.message);
  const lines = expanded.split("\n");
  const blocks: React.ReactNode[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const key = `block:${blocks.length}`;
    blocks.push(
      <p key={key} className="whitespace-pre-wrap break-words">
        {renderTokens(tokenizeLine(run.join("\n"), props.host), key)}
      </p>,
    );
    run = [];
  };
  for (const line of lines) {
    if (line.trim().length === 0) flush();
    else run.push(line);
  }
  flush();
  if (blocks.length === 0) return null;
  return <div className={props.className}>{blocks}</div>;
}
