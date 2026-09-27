import type { ModelSpec } from "./catalog";

export function buildPrompt(input: {
  model: ModelSpec;
  customCharacter: string;
  extra: string;
  ownLabel?: string;
  ownPrompt?: string;
  outfit: string;
  outfitLabel: string;
  stand: string;
  standLabel: string;
  blank: string;
  scene: string;
  styleDit: string;
  styleTags: string;
  styleLabel: string;
  flat: boolean;
}): { prompt: string; title: string } {
  const custom = input.customCharacter.trim();
  const ownPrompt = input.ownPrompt?.trim() ?? "";
  const ownLabel = input.ownLabel?.trim() ?? "";
  const extra = input.extra.trim();
  const outfit = input.outfit.trim();
  const stand = input.stand.trim();
  const blank = input.blank.trim();
  const scene = input.scene.trim();
  const title = [ownLabel || (custom ? custom.slice(0, 12) : "未命名"), input.outfitLabel, stand ? input.standLabel : "", blank ? "空白背景" : "", scene ? "場景" : "", input.styleLabel]
    .filter(Boolean)
    .join(" · ");

  if (input.model.family === "dit") {
    const who = custom || ownPrompt || "an original anime character";
    const parts = [
      `${input.flat ? "Illustration" : "Anime illustration"} of ${who}.`,
      outfit ? `Clothing: ${outfit}.` : "",
      stand ? `Pose: ${stand}.` : "",
      blank ? `Setting: ${blank}.` : "",
      scene ? `Setting: ${scene}.` : "",
      `Style: ${input.styleDit}.`,
      "Single character, coherent anatomy, detailed eyes and hands, no text, no watermark.",
    ].filter(Boolean);
    if (extra) parts.push(extra);
    return { prompt: parts.join(" "), title };
  }

  const who = custom || ownPrompt || "1girl, solo, original character";
  const tags = [who, outfit, stand, blank, scene, input.styleTags, input.flat ? "" : "masterpiece, best quality"].filter(Boolean);
  if (extra) tags.push(extra);
  return { prompt: tags.join(", "), title };
}