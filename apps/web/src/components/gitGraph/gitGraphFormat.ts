const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** The full timestamp, for a tooltip that has room for seconds. */
export function formatGitGraphDateTime(unixSeconds: number): string {
  return DATE_TIME_FORMAT.format(new Date(unixSeconds * 1000));
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "3 days ago", as the commit list reads once a date is too old to be memorable. */
export function formatGitGraphRelative(unixSeconds: number, nowMs = Date.now()): string {
  const deltaSeconds = Math.round(unixSeconds - nowMs / 1000);
  const magnitude = Math.abs(deltaSeconds);
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (magnitude >= seconds) {
      return RELATIVE_FORMAT.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return RELATIVE_FORMAT.format(deltaSeconds, "second");
}

export function shortHash(hash: string, length = 8): string {
  return hash.slice(0, length);
}

/** Lane colors, chosen to stay distinct from each other on light and dark backgrounds. */
const GIT_GRAPH_COLORS = [
  "#0085d9",
  "#d9008f",
  "#00d90a",
  "#d98500",
  "#a300d9",
  "#ff0000",
  "#00d9cc",
  "#e138e8",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#ffcc00",
] as const;

export function gitGraphColor(index: number): string {
  return GIT_GRAPH_COLORS[index % GIT_GRAPH_COLORS.length]!;
}

/**
 * Gitmoji and common emoji shortcodes, so a commit written `:sparkles: add x` reads as `✨ add x`
 * like Git Graph renders it. Only codes Git Graph itself ships are mapped.
 */
const EMOJI_SHORTCODES: Readonly<Record<string, string>> = {
  ":art:": "🎨",
  ":ambulance:": "🚑",
  ":beers:": "🍻",
  ":bookmark:": "🔖",
  ":boom:": "💥",
  ":bug:": "🐛",
  ":building_construction:": "🏗️",
  ":bulb:": "💡",
  ":card_file_box:": "🗃️",
  ":children_crossing:": "🚸",
  ":construction:": "🚧",
  ":construction_worker:": "👷",
  ":globe_with_meridians:": "🌐",
  ":goal_net:": "🥅",
  ":green_heart:": "💚",
  ":heavy_plus_sign:": "➕",
  ":heavy_minus_sign:": "➖",
  ":iphone:": "📱",
  ":label:": "🏷️",
  ":lipstick:": "💄",
  ":lock:": "🔒",
  ":loud_sound:": "🔊",
  ":mag:": "🔍",
  ":memo:": "📝",
  ":money_with_wings:": "💸",
  ":monocle_face:": "🧐",
  ":mute:": "🔇",
  ":package:": "📦",
  ":passport_control:": "🛂",
  ":pencil2:": "✏️",
  ":poop:": "💩",
  ":pushpin:": "📌",
  ":recycle:": "♻️",
  ":recycle::": "♻️",
  ":rewind:": "⏪",
  ":rotating_light:": "🚨",
  ":see_no_evil:": "🙈",
  ":sparkles:": "✨",
  ":speech_balloon:": "💬",
  ":tada:": "🎉",
  ":test_tube:": "🧪",
  ":triangular_flag_on_post:": "🚩",
  ":twisted_rightwards_arrows:": "🔀",
  ":wastebasket:": "🗑️",
  ":wheelchair:": "♿",
  ":white_check_mark:": "✅",
  ":wrench:": "🔧",
  ":zap:": "⚡",
};

export function replaceEmojiShortcodes(text: string): string {
  return text.replace(/:[a-z0-9_+-]+:/g, (code) => EMOJI_SHORTCODES[code] ?? code);
}
