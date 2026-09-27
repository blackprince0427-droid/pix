export type ClothPart = "set" | "top" | "bottom" | "socks";

export type PieceKind = "who" | "look" | "act" | "scene" | "style" | "shoes" | ClothPart;

export type SplitPrompt = {
  characters: { name: string; prompt: string }[];
  clothes: { part: ClothPart; name: string; prompt: string }[];
  actions: { name: string; prompt: string }[];
  scene: string;
  style: string;
};

const SOCK = /sock|stocking|thigh[\s-]?high|pantyhose|tights|過膝|襪子|襪/i;
const BOTTOM = /skirt|pants|trousers|shorts|jeans|leggings|miniskirt|短裙|裙子|下身|長褲|短褲/i;
const SHOES = /loafer|shoe|boot|heel|sandal|sneaker|鞋/i;
const TOP = /cardigan|jacket|blouse|shirt|bowtie|bow|coat|hoodie|sweater|vest|\btie\b|scarf|開衫|上衣|外套|襯衫|蝴蝶結|領巾|圍巾/i;
const SET = /gear|outfit|uniform|costume|dress|clothes|combat|整套|校服|戰鬥裝/i;
const ACT = /pose|gesture|looking at viewer|lifted|fist|raised|holding|standing|sitting|running|walking|jumping|動作/i;
const SCENE = /background|hearts?|sparkles?|gingham|exclamation|背景|場景/i;
const STYLE = /style|masterpiece|best quality|highly detailed|detailed |lineart|lighting|vibrant|official art|absurdres|sharp lines|畫風|質素/i;
const LOOK = /hair|eyes?|blush|smile|twintail|ribbon|braid|bangs|expression|1girl|1boy|2girls|solo|外貌/i;

function kindOf(fragment: string): PieceKind {
  const sock = SOCK.test(fragment);
  const bottom = BOTTOM.test(fragment);
  const top = TOP.test(fragment);
  const shoes = SHOES.test(fragment);
  const set = SET.test(fragment);
  const slots = Number(sock) + Number(bottom) + Number(top) + Number(shoes);
  if (slots > 1 || (set && slots > 0)) return "set";
  if (sock) return "socks";
  if (bottom) return "bottom";
  if (shoes) return "shoes";
  if (top) return "top";
  if (set) return "set";
  if (ACT.test(fragment)) return "act";
  if (SCENE.test(fragment)) return "scene";
  if (STYLE.test(fragment)) return "style";
  if (LOOK.test(fragment)) return "look";
  return "who";
}

function piecesOf(parts: Record<ClothPart | "shoes", string[]>) {
  return {
    top: parts.top.join(", "),
    bottom: parts.bottom.join(", "),
    socks: parts.socks.join(", "),
    shoes: parts.shoes.join(", "),
    set: [...parts.top, ...parts.bottom, ...parts.socks, ...parts.shoes, ...parts.set].join(", "),
  };
}

function characterName(segment: string) {
  const head = segment.split(/\\?\(/)[0]?.trim() || segment;
  return head.split(/\s+/).slice(0, 3).join(" ").slice(0, 24);
}

export function promptPieces(text: string): { kind: PieceKind; text: string }[] {
  return text
    .split(/[,，]/)
    .map((item) => item.replace(/^[.\s]+|[.\s]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((item) => ({ kind: kindOf(item), text: item }));
}

export function splitFromPieces(pieces: { kind: PieceKind; text: string }[]): SplitPrompt {
  type Bucket = {
    name: string;
    who: string[];
    look: string[];
    act: string[];
    parts: Record<ClothPart | "shoes", string[]>;
  };
  const buckets: Bucket[] = [];
  let current: Bucket | null = null;
  const scenes: string[] = [];
  const styles: string[] = [];
  const blank = (): Bucket => ({
    name: "",
    who: [],
    look: [],
    act: [],
    parts: { set: [], top: [], bottom: [], socks: [], shoes: [] },
  });
  const ensure = () => {
    if (!current) {
      current = blank();
      buckets.push(current);
    }
    return current;
  };

  for (const piece of pieces) {
    const segment = piece.text.trim();
    if (!segment) continue;
    if (piece.kind === "scene") {
      scenes.push(segment);
      continue;
    }
    if (piece.kind === "style") {
      styles.push(segment);
      continue;
    }
    if (piece.kind === "who") {
      if (current && !current.name) {
        current.name = characterName(segment);
        current.who.push(segment);
      } else {
        current = blank();
        current.name = characterName(segment);
        current.who.push(segment);
        buckets.push(current);
      }
      continue;
    }
    const bucket = ensure();
    if (piece.kind === "look") bucket.look.push(segment);
    else if (piece.kind === "act") bucket.act.push(segment);
    else if (piece.kind === "shoes") bucket.parts.shoes.push(segment);
    else bucket.parts[piece.kind].push(segment);
  }

  const characters: SplitPrompt["characters"] = [];
  const clothes: SplitPrompt["clothes"] = [];
  const actions: SplitPrompt["actions"] = [];
  for (const bucket of buckets) {
    const partText = piecesOf(bucket.parts);
    const base = bucket.name || "衣服";
    const appearance = [...bucket.who, ...bucket.look].join(", ").slice(0, 1200);
    if (bucket.name && appearance) characters.push({ name: bucket.name, prompt: appearance });
    const named: { part: ClothPart; prompt: string; suffix: string }[] = [
      { part: "top", prompt: partText.top, suffix: "上衣" },
      { part: "bottom", prompt: partText.bottom, suffix: "下身" },
      { part: "socks", prompt: partText.socks, suffix: "襪子" },
    ];
    for (const item of named) {
      if (!item.prompt) continue;
      clothes.push({ part: item.part, name: `${base} ${item.suffix}`.slice(0, 24), prompt: item.prompt.slice(0, 800) });
    }
    const specific = [partText.top, partText.bottom, partText.socks].filter(Boolean).length;
    if (partText.set && (specific !== 1 || bucket.parts.set.length > 0 || bucket.parts.shoes.length > 0)) {
      clothes.push({ part: "set", name: `${base} 整套`.slice(0, 24), prompt: partText.set.slice(0, 800) });
    }
    if (bucket.act.length && bucket.name) {
      actions.push({ name: `${base} 動作`.slice(0, 24), prompt: bucket.act.join(", ").slice(0, 800) });
    }
  }
  return {
    characters,
    clothes,
    actions,
    scene: scenes.join(", ").slice(0, 800),
    style: styles.join(", ").slice(0, 800),
  };
}

export function splitPrompt(text: string): SplitPrompt {
  return splitFromPieces(promptPieces(text));
}
