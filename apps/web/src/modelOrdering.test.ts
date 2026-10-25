import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { moveFavoriteModel, providerModelKey, sortProviderModelItems } from "./modelOrdering";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");

describe("favorite model order", () => {
  it("lists favorites in the order the user arranged, not by provider", () => {
    const items = [
      { instanceId: codex, slug: "gpt" },
      { instanceId: claude, slug: "opus" },
      { instanceId: claude, slug: "sonnet" },
    ];
    const sorted = sortProviderModelItems(items, {
      favoriteOrder: [providerModelKey(claude, "sonnet"), providerModelKey(codex, "gpt")],
      instanceOrder: [claude, codex],
    });
    expect(sorted.map((item) => item.slug)).toEqual(["sonnet", "gpt", "opus"]);
  });

  it("moves a dragged favorite into the place of the one it was dropped on", () => {
    const favorites = [
      { provider: codex, model: "gpt" },
      { provider: claude, model: "opus" },
      { provider: claude, model: "sonnet" },
    ];
    const key = (favorite: (typeof favorites)[number]) =>
      providerModelKey(favorite.provider, favorite.model);

    expect(
      moveFavoriteModel(favorites, key(favorites[2]!), key(favorites[0]!)).map((f) => f.model),
    ).toEqual(["sonnet", "gpt", "opus"]);
    expect(
      moveFavoriteModel(favorites, key(favorites[0]!), key(favorites[1]!)).map((f) => f.model),
    ).toEqual(["opus", "gpt", "sonnet"]);
    expect(moveFavoriteModel(favorites, "missing", key(favorites[0]!))).toEqual(favorites);
  });
});
