export type ModelId = "tsubaki" | "haruka" | "hoshino";

export type ModelSpec = {
  id: ModelId;
  label: string;
  note: string;
  versionId: string;
  family: "dit" | "sdxl";
};

export const MODELS: ModelSpec[] = [
  {
    id: "tsubaki",
    label: "Tsubaki.2",
    note: "自然語句最好，多人與動作較穩",
    versionId: "1983308862240288769",
    family: "dit",
  },
  {
    id: "haruka",
    label: "Haruka v2",
    note: "標籤控制細，手與細節穩定",
    versionId: "1861558740588989558",
    family: "sdxl",
  },
  {
    id: "hoshino",
    label: "Hoshino v2",
    note: "偏日本流行的復古動畫感",
    versionId: "1954632828118619567",
    family: "sdxl",
  },
];

export const ANIME_STYLE = {
  dit: "Japanese TV anime screenshot, thin crisp black lineart, flat saturated cel colors, very few shadows, strong glossy white highlights on hair and skin",
  tags: "anime screenshot, anime coloring, cel shading, thin lineart, flat color, glossy hair, glossy skin, bright colors",
};

export const STYLES = [
  {
    id: "anime",
    label: "動漫",
    hint: "賽璐璐光澤",
    dit: ANIME_STYLE.dit,
    tags: ANIME_STYLE.tags,
  },
  {
    id: "flatline",
    label: "Flatline",
    hint: "平面粗白邊",
    dit: "Flatline flat vector illustration, vivid colors, thick white outline, blue inner hair color, watercolor softness, soft light, sharp lines, vivid contrast, official visual, highest quality",
    tags: "Flatline, flat vector illustration, vivid colors, white thick outline, outline, blue inner hair color, watercolor, soft light, masterpiece, highest quality, ultra hd, high resolution, absurdres, 8k, official visual, sharp lines, vivid contrast",
  },
] as const;

export const STAND = {
  dit: "standing perfectly straight, full body in frame, front view, looking at the viewer, arms straight down at the sides, feet together, barefoot",
  tags: "standing, full body, front view, looking at viewer, arms at sides, straight posture, barefoot",
};

export const BLANK = {
  dit: "a completely plain white background with nothing else",
  tags: "white background, plain background, simple background",
};

export const OUTFITS = [
  { id: "serafuku", label: "水手服", hint: "領巾", prompt: "sailor uniform, serafuku, neckerchief" },
  { id: "blazer", label: "西裝校服", hint: "外套襯衫", prompt: "school uniform, blazer, white shirt, pleated skirt" },
  { id: "casual", label: "便服", hint: "上衣長褲", prompt: "casual clothes, t-shirt, jeans" },
  { id: "yukata", label: "浴衣", hint: "腰帶", prompt: "yukata, obi" },
] as const;

export const ASPECTS = [
  { id: "1:1", label: "方圖", hint: "1:1" },
  { id: "3:4", label: "直幅", hint: "3:4" },
  { id: "2:3", label: "海報", hint: "2:3" },
  { id: "9:16", label: "直式", hint: "9:16" },
  { id: "4:3", label: "橫幅", hint: "4:3" },
  { id: "16:9", label: "寬螢幕", hint: "16:9" },
] as const;

export const MODES = [
  { id: "lite", label: "Lite", hint: "較快" },
  { id: "standard", label: "Standard", hint: "平衡" },
  { id: "pro", label: "Pro", hint: "較細" },
  { id: "ultra", label: "Ultra", hint: "最耗點數" },
] as const;

export const DEFAULT_NEGATIVE =
  "lowres, worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, text, watermark, signature, blurry, jpeg artifacts";
