import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Images,
  KeyRound,
  LoaderCircle,
  Pencil,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  redirectToLoginIfRequired,
  useRefetchWhenConnectorReady,
} from "@/lib/app-data";
import { deleteWork, listWorks, saveWork, type Work } from "@/lib/gallery";
import {
  ASPECTS,
  BLANK,
  DEFAULT_NEGATIVE,
  MODELS,
  MODES,
  OUTFITS,
  STAND,
  STYLES,
  type ModelId,
} from "@/lib/pixai/catalog";
import { createGeneration, fetchMedia, listDriveAlbum, pollGeneration, saveToDrive, type DriveFile } from "@/lib/pixai/fns";
import { buildPrompt } from "@/lib/pixai/prompt";
import { promptPieces, splitFromPieces, splitPrompt, type PieceKind } from "@/lib/pixai/split-prompt";

const PREFS_KEY = "huiye.prefs.v1";
const ROSTER_KEY = "huiye.roster.v1";
const PROMPT_KEY = "huiye.prompt.v1";
const LIBRARY_KEY = "huiye.prompts.v1";

type PieceDraft = { id: string; kind: PieceKind; text: string };
type KeptPrompt = { id: string; title: string; text: string };

function asKept(value: unknown): KeptPrompt[] {
  if (!Array.isArray(value)) return [];
  const rows: KeptPrompt[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text = String(row.text ?? "").trim().slice(0, 4000);
    if (!text) continue;
    const title = String(row.title ?? "").trim().slice(0, 24) || text.split(/[,，]/)[0]?.trim().slice(0, 24) || "未命名";
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : `prompt-${rows.length}`;
    rows.push({ id, title, text });
    if (rows.length >= 30) break;
  }
  return rows;
}
const MINE_KEY = "huiye.characters.v1";

type SavedGroup = { id: string; label: string };
type SavedCharacter = { id: string; groupId: string; label: string; prompt: string };
type Roster = {
  groups: SavedGroup[];
  characters: SavedCharacter[];
  labels: { studio: string; star: string };
};

const EMPTY_ROSTER: Roster = {
  groups: [],
  characters: [],
  labels: { studio: "內建", star: "星契・原創女魔法師" },
};

function asRoster(value: unknown): Roster | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<Roster>;
  if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.characters)) return null;
  const groups = parsed.groups
    .filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
    .slice(0, 12)
    .map((item) => ({ id: item.id, label: item.label.slice(0, 32) }));
  const ids = new Set(groups.map((item) => item.id));
  const characters = parsed.characters
    .filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.groupId === "string" &&
        (item.groupId === "" || ids.has(item.groupId)) &&
        typeof item.label === "string" &&
        typeof item.prompt === "string",
    )
    .slice(0, 80)
    .map((item) => ({
      id: item.id,
      groupId: item.groupId,
      label: item.label.slice(0, 24),
      prompt: item.prompt.slice(0, 1200),
    }));
  const studio = parsed.labels?.studio?.trim().slice(0, 32);
  const star = parsed.labels?.star?.trim().slice(0, 32);
  return {
    groups,
    characters,
    labels: {
      studio: studio || EMPTY_ROSTER.labels.studio,
      star: star || EMPTY_ROSTER.labels.star,
    },
  };
}

function asSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return [];
  const rows: Snippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label ?? row.name ?? "").trim().slice(0, 24);
    const prompt = String(row.prompt ?? "").trim().slice(0, 800);
    if (!label || !prompt) continue;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : `snip-${rows.length}`;
    rows.push({ id, label, prompt });
    if (rows.length >= 40) break;
  }
  return rows;
}

function clothPartOf(value: unknown): "set" | "top" | "bottom" | "socks" {
  const text = String(value ?? "").trim();
  const key = text.toLowerCase();
  if (key === "top" || text === "上衣") return "top";
  if (key === "bottom" || text === "下身") return "bottom";
  if (key === "socks" || key === "sock" || text === "襪子") return "socks";
  return "set";
}

type Snippet = { id: string; label: string; prompt: string };

type Prefs = {
  apiKey: string;
  modelId: ModelId;
  characterId: string;
  customOn: boolean;
  customCharacter: string;
  outfitId: string;
  outfitPrompt: string;
  outfits: Snippet[];
  clothMode: "set" | "parts";
  tops: Snippet[];
  topId: string;
  topPrompt: string;
  bottoms: Snippet[];
  bottomId: string;
  bottomPrompt: string;
  socks: Snippet[];
  sockId: string;
  sockPrompt: string;
  standPrompt: string;
  blankPrompt: string;
  actionId: string;
  actions: Snippet[];
  sceneId: string;
  sceneNote: string;
  styleId: string;
  aspect: string;
  size: "1k" | "1.5k";
  mode: string;
  batch: 1 | 4;
  promptHelper: boolean;
  negative: string;
  extra: string;
  seed: string;
};

const DEFAULT_PREFS: Prefs = {
  apiKey: "",
  modelId: "tsubaki",
  characterId: "",
  customOn: false,
  customCharacter: "",
  outfitId: "",
  outfitPrompt: "",
  outfits: [],
  clothMode: "set",
  tops: [],
  topId: "",
  topPrompt: "",
  bottoms: [],
  bottomId: "",
  bottomPrompt: "",
  socks: [],
  sockId: "",
  sockPrompt: "",
  standPrompt: STAND.tags,
  blankPrompt: BLANK.tags,
  actionId: "stand",
  actions: [],
  sceneId: "blank",
  sceneNote: "",
  styleId: "anime",
  aspect: "3:4",
  size: "1k",
  mode: "standard",
  batch: 1,
  promptHelper: false,
  negative: DEFAULT_NEGATIVE,
  extra: "",
  seed: "",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Chip({
  pressed,
  label,
  hint,
  onClick,
  seal,
  className,
}: {
  pressed: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  seal?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-shadow duration-200 " +
        (pressed
          ? "bg-cinnabar text-cinnabar-ink shadow-card"
          : "bg-sheet text-ink shadow-card hover:shadow-card-hover") +
        (className ? ` ${className}` : "")
      }
    >
      {seal ? (
        <span
          data-seal={seal}
          className="grid size-8 shrink-0 place-items-center rounded-lg font-serif text-sm text-ink"
          aria-hidden="true"
        >
          {label.slice(0, 1)}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? (
          <span className={"line-clamp-2 block text-xs break-all " + (pressed ? "text-cinnabar-ink/80" : "text-muted")}>
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <h2 className="mb-2 text-base font-semibold text-ink">{children}</h2>;
}

function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[min(42rem,calc(100vh-1.5rem))] w-full max-w-lg overflow-y-auto rounded-card bg-sheet p-4 shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm shadow-card">
            關閉
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Atelier() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [roster, setRoster] = useState<Roster>(EMPTY_ROSTER);
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [outfitImport, setOutfitImport] = useState("");
  const [clothName, setClothName] = useState("");
  const [clothPart, setClothPart] = useState<"set" | "top" | "bottom" | "socks">("set");
  const [clothPrompt, setClothPrompt] = useState("");
  const [rawPrompt, setRawPrompt] = useState("");
  const [pieces, setPieces] = useState<PieceDraft[]>([]);
  const [keptPrompts, setKeptPrompts] = useState<KeptPrompt[]>([]);
  const [keptId, setKeptId] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [panel, setPanel] = useState<null | "character" | "analyze" | "clothes" | "action" | "scene" | "setup">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [actionImport, setActionImport] = useState("");
  const [ready, setReady] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [phaseJobs, setPhaseJobs] = useState<{ id: string; label: string; status: string; started: number }[]>([]);
  const [now, setNow] = useState(0);
  const [statusText, setStatusText] = useState("選擇造型後開始繪製");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveWait, setDriveWait] = useState(false);
  const jobsRef = useRef<Map<string, { cancel: boolean }>>(new Map());
  const savePayload = useRef<{ base64: string; mime: string; label: string } | null>(null);

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (raw) setKeptPrompts(asKept(JSON.parse(raw)));
    } catch {
      /* keep empty */
    }
    setLibraryReady(true);
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(keptPrompts));
  }, [keptPrompts, libraryReady]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        setPrefs({
          ...DEFAULT_PREFS,
          ...parsed,
          apiKey: parsed.apiKey ?? "",
          actionId:
            parsed.actionId === "stand" || parsed.actionId === "" || parsed.actionId?.startsWith("saved:")
              ? (parsed.actionId ?? "stand")
              : "stand",
          sceneId: parsed.sceneId === "blank" || parsed.sceneId === "" ? parsed.sceneId : "blank",
          sceneNote: typeof parsed.sceneNote === "string" ? parsed.sceneNote : "",
          styleId: parsed.styleId === "flatline" ? "flatline" : "anime",
          outfitId:
            parsed.outfitId?.startsWith("saved:") ||
            ["", "serafuku", "blazer", "casual", "yukata", "custom"].includes(parsed.outfitId ?? "")
              ? (parsed.outfitId ?? "")
              : "",
          outfitPrompt: typeof parsed.outfitPrompt === "string" ? parsed.outfitPrompt : "",
          outfits: asSnippets(parsed.outfits),
          clothMode: parsed.clothMode === "parts" ? "parts" : "set",
          tops: asSnippets(parsed.tops),
          topId: parsed.topId?.startsWith("saved:") ? parsed.topId : "",
          topPrompt: typeof parsed.topPrompt === "string" ? parsed.topPrompt : "",
          bottoms: asSnippets(parsed.bottoms),
          bottomId: parsed.bottomId?.startsWith("saved:") ? parsed.bottomId : "",
          bottomPrompt: typeof parsed.bottomPrompt === "string" ? parsed.bottomPrompt : "",
          socks: asSnippets(parsed.socks),
          sockId: parsed.sockId?.startsWith("saved:") ? parsed.sockId : "",
          sockPrompt: typeof parsed.sockPrompt === "string" ? parsed.sockPrompt : "",
          standPrompt: parsed.standPrompt?.trim() ? parsed.standPrompt : STAND.tags,
          blankPrompt: parsed.blankPrompt?.trim() ? parsed.blankPrompt : BLANK.tags,
          actions: asSnippets(parsed.actions),
        });
      }
    } catch {
      /* keep defaults */
    }
    try {
      const rawRoster = localStorage.getItem(ROSTER_KEY);
      if (rawRoster) {
        const next = asRoster(JSON.parse(rawRoster));
        if (next) setRoster(next);
      } else {
        const rawMine = localStorage.getItem(MINE_KEY);
        if (rawMine) {
          const parsed = JSON.parse(rawMine) as Array<{ id?: string; label?: string; prompt?: string }>;
          if (Array.isArray(parsed) && parsed.length) {
            const groupId = "mine-legacy";
            const next = asRoster({
              groups: [{ id: groupId, label: "我的角色" }],
              characters: parsed
                .filter((item) => item && typeof item.id === "string" && typeof item.label === "string" && typeof item.prompt === "string")
                .map((item) => ({ ...item, groupId })),
              labels: EMPTY_ROSTER.labels,
            });
            if (next) setRoster(next);
          }
        }
      }
    } catch {
      /* keep empty roster */
    }
    try {
      const savedPrompt = localStorage.getItem(PROMPT_KEY);
      if (savedPrompt) setPromptOverride(savedPrompt);
    } catch {
      /* keep the built prompt */
    }
    setReady(true);
    void listWorks()
      .then((rows) => {
        setWorks(rows);
        setActiveId(rows[0]?.id ?? null);
      })
      .catch(() => setError("這個瀏覽器無法開啟本機圖庫。"));
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  }, [roster, ready]);

  useEffect(() => {
    if (!ready) return;
    if (promptOverride === null) localStorage.removeItem(PROMPT_KEY);
    else localStorage.setItem(PROMPT_KEY, promptOverride);
  }, [promptOverride, ready]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const work of works) next[work.id] = URL.createObjectURL(work.blob);
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [works]);

  useEffect(() => {
    if (!phaseJobs.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phaseJobs.length]);

  const model = MODELS.find((item) => item.id === prefs.modelId) ?? MODELS[0]!;
  const selectedOwn = prefs.customOn ? null : (roster.characters.find((item) => item.id === prefs.characterId) ?? null);
  const piecePrompt =
    prefs.clothMode === "parts"
      ? [prefs.topId ? prefs.topPrompt : "", prefs.bottomId ? prefs.bottomPrompt : "", prefs.sockId ? prefs.sockPrompt : ""]
          .map((item) => item.trim())
          .filter(Boolean)
          .join(", ")
      : prefs.outfitId
        ? prefs.outfitPrompt
        : "";
  const pieceLabel =
    prefs.clothMode === "parts"
      ? [
          prefs.tops.find((item) => prefs.topId === `saved:${item.id}`)?.label,
          prefs.bottoms.find((item) => prefs.bottomId === `saved:${item.id}`)?.label,
          prefs.socks.find((item) => prefs.sockId === `saved:${item.id}`)?.label,
        ]
          .filter(Boolean)
          .join("·")
      : (prefs.outfits.find((item) => prefs.outfitId === `saved:${item.id}`)?.label ??
        OUTFITS.find((item) => item.id === prefs.outfitId)?.label ??
        (prefs.outfitId === "custom" ? "自訂衣服" : ""));
  const built = useMemo(
    () =>
      buildPrompt({
        model,
        customCharacter: prefs.customOn ? prefs.customCharacter : "",
        extra: prefs.extra,
        ownLabel: selectedOwn?.label,
        ownPrompt: selectedOwn?.prompt,
        outfit: piecePrompt,
        outfitLabel: pieceLabel,
        stand: prefs.actionId ? prefs.standPrompt : "",
        standLabel:
          prefs.actionId === "stand"
            ? "絕對站立"
            : (prefs.actions.find((item) => prefs.actionId === `saved:${item.id}`)?.label ?? ""),
        blank: prefs.sceneId === "blank" ? prefs.blankPrompt : "",
        scene: prefs.sceneId === "blank" ? "" : prefs.sceneNote,
        styleDit: (STYLES.find((item) => item.id === prefs.styleId) ?? STYLES[0]).dit,
        styleTags: (STYLES.find((item) => item.id === prefs.styleId) ?? STYLES[0]).tags,
        styleLabel: (STYLES.find((item) => item.id === prefs.styleId) ?? STYLES[0]).label,
        flat: prefs.styleId === "flatline",
      }),
    [model, prefs, selectedOwn],
  );
  const prompt = promptOverride ?? built.prompt;
  const active = works.find((work) => work.id === activeId) ?? null;
  const activeUrl = active ? urls[active.id] : "";

  function patch(partial: Partial<Prefs>) {
    setPromptOverride(null);
    setPrefs((current) => ({ ...current, ...partial }));
  }

  async function remember(shot: { title: string; prompt: string; mime: string; base64: string }) {
    const blob = new Blob([Uint8Array.from(atob(shot.base64), (char) => char.charCodeAt(0))], {
      type: shot.mime,
    });
    const work: Work = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      title: shot.title,
      prompt: shot.prompt,
      mime: shot.mime,
      blob,
    };
    await saveWork(work);
    setWorks((current) => [work, ...current].slice(0, 36));
    setActiveId(work.id);
    return work;
  }

  async function generate() {
    if (jobsRef.current.size >= 4) {
      setError("同時最多 4 個繪製。等其中一個完成再送。");
      return;
    }
    if (!prefs.apiKey.trim()) {
      setError("請先貼上 PixAI API 金鑰。金鑰只留在這台裝置。");
      return;
    }
    const described = Boolean(selectedOwn) || (prefs.customOn && Boolean(prefs.customCharacter.trim()));
    if (!described) {
      setError("請先加入角色，或用臨時描述。");
      return;
    }
    const jobId = crypto.randomUUID();
    const snapshot = {
      apiKey: prefs.apiKey.trim(),
      modelId: model.id,
      prompt,
      title: built.title,
      negative: prefs.negative,
      aspect: prefs.aspect,
      size: prefs.size,
      batch: prefs.batch,
      mode: prefs.mode,
      promptHelper: prefs.promptHelper,
      seed: prefs.seed,
    };
    jobsRef.current.set(jobId, { cancel: false });
    setPhaseJobs((current) => [...current, { id: jobId, label: snapshot.title, status: "正在交給 PixAI…", started: Date.now() }]);
    setError("");
    const cancelled = () => jobsRef.current.get(jobId)?.cancel === true;
    const mark = (status: string) => setPhaseJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status } : job)));
    const endJob = () => {
      jobsRef.current.delete(jobId);
      setPhaseJobs((current) => current.filter((job) => job.id !== jobId));
    };
    try {
      const created = await createGeneration({
        data: {
          apiKey: snapshot.apiKey,
          modelId: snapshot.modelId,
          prompt: snapshot.prompt,
          negative: snapshot.negative,
          aspect: snapshot.aspect,
          size: snapshot.size,
          batch: snapshot.batch,
          mode: snapshot.mode,
          promptHelper: snapshot.promptHelper,
          seed: snapshot.seed,
        },
      });
      if (cancelled()) {
        endJob();
        return;
      }
      if (!created.ok) {
        setError(created.error);
        endJob();
        return;
      }
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2000);
        if (cancelled()) {
          setStatusText("已停止等待。PixAI 端的任務可能仍在進行。");
          endJob();
          return;
        }
        const polled = await pollGeneration({
          data: { apiKey: snapshot.apiKey, taskId: created.taskId },
        });
        if (!polled.ok) {
          setError(polled.error);
          endJob();
          return;
        }
        if (polled.status === "waiting") mark("排隊中");
        if (polled.status === "running") mark("繪製中");
        if (polled.status === "failed" || polled.status === "cancelled") {
          setError(polled.error || (polled.status === "cancelled" ? "任務已取消" : "生成失敗"));
          endJob();
          return;
        }
        if (polled.status === "completed") {
          if (!polled.mediaIds.length) {
            setError("任務完成了，但沒有圖片。");
            endJob();
            return;
          }
          mark("正在取回圖片…");
          for (const mediaId of polled.mediaIds) {
            const media = await fetchMedia({
              data: { apiKey: snapshot.apiKey, mediaId },
            });
            if (!media.ok) {
              setError(media.error);
              endJob();
              return;
            }
            await remember({
              title: snapshot.title,
              prompt: snapshot.prompt,
              mime: media.mime,
              base64: media.base64,
            });
          }
          setStatusText(polled.mediaIds.length > 1 ? `完成 ${polled.mediaIds.length} 張，已放進圖庫` : "完成，已放進圖庫");
          setNotice("PixAI 不會永久保留圖片，這裡的圖庫會留在這台裝置。");
          endJob();
          return;
        }
      }
      setError("等太久了。可以稍後用同一個金鑰再試一次。");
      endJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成中斷");
      endJob();
    }
  }

  async function pushDrive(payload: { base64: string; mime: string; label: string }) {
    setDriveBusy(true);
    setError("");
    savePayload.current = payload;
    try {
      const result = await saveToDrive({ data: payload });
      if (!result.ok) {
        if (result.pending) {
          setDriveWait(true);
          setNotice("正在等待 Google Drive 授權…");
          return;
        }
        if (result.loginRequired) {
          setNotice("需要先連接 Google Drive。");
          redirectToLoginIfRequired({
            ok: false,
            data: null,
            loginRequired: true,
            loginUrl: result.loginUrl,
            errorMessage: result.error,
          });
          return;
        }
        setError(result.error);
        return;
      }
      setDriveWait(false);
      setNotice(result.message);
      if (result.uploaded) void refreshDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法保存到 Google Drive");
    } finally {
      setDriveBusy(false);
    }
  }

  async function refreshDrive() {
    setDriveBusy(true);
    setError("");
    try {
      const result = await listDriveAlbum();
      if (!result.ok) {
        if (result.pending) {
          setDriveWait(true);
          setNotice("正在等待 Google Drive 授權…");
          return;
        }
        if (result.loginRequired) {
          redirectToLoginIfRequired({
            ok: false,
            data: null,
            loginRequired: true,
            loginUrl: result.loginUrl,
            errorMessage: result.error,
          });
          setNotice("需要先連接 Google Drive。");
          return;
        }
        setError(result.error);
        return;
      }
      setDriveWait(false);
      setDriveFiles(result.files);
      setNotice(result.files.length ? `「${result.folderName}」裡有 ${result.files.length} 個檔案。` : `「${result.folderName}」目前是空的。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法讀取 Google Drive");
    } finally {
      setDriveBusy(false);
    }
  }

  useRefetchWhenConnectorReady(driveWait, () => {
    const payload = savePayload.current;
    if (payload) return pushDrive(payload);
    return refreshDrive();
  });

  async function onSaveDrive() {
    if (!active) return;
    const buffer = await active.blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    await pushDrive({
      base64: btoa(binary),
      mime: active.mime,
      label: active.title,
    });
  }

  function downloadActive() {
    if (!active || !activeUrl) return;
    const anchor = document.createElement("a");
    anchor.href = activeUrl;
    const ext = active.mime.includes("webp") ? "webp" : active.mime.includes("jpeg") ? "jpg" : "png";
    anchor.download = `${active.title}.${ext}`.replace(/[^\w\u4e00-\u9fff.-]+/g, "_");
    anchor.click();
  }

  async function removeActive() {
    if (!active) return;
    await deleteWork(active.id);
    const next = works.filter((work) => work.id !== active.id);
    setWorks(next);
    setActiveId(next[0]?.id ?? null);
  }

  function updateCharacter(id: string, partial: { label?: string; prompt?: string }) {
    setRoster((current) => ({
      ...current,
      characters: current.characters.map((row) => (row.id === id ? { ...row, ...partial } : row)),
    }));
    if (prefs.characterId === id) setPromptOverride(null);
  }

  function characterList(groupId: string) {
    const rows = roster.characters.filter((item) => item.groupId === groupId);
    if (!rows.length) return null;
    return (
      <ul className="grid grid-cols-1 gap-2">
        {rows.map((item) => (
          <li key={item.id} className="flex items-stretch gap-1">
            {editingId === item.id ? (
              <div className="min-w-0 flex-1 space-y-2 rounded-xl bg-paper p-3">
                <label className="block text-sm">
                  角色名稱
                  <input
                    value={item.label}
                    maxLength={24}
                    onChange={(event) => updateCharacter(item.id, { label: event.target.value.slice(0, 24) })}
                    className="mt-1 h-11 w-full rounded-xl border border-line bg-sheet px-3 text-sm outline-none focus-visible:border-cinnabar"
                  />
                </label>
                <label className="block text-sm">
                  角色 prompt
                  <textarea
                    value={item.prompt}
                    maxLength={1200}
                    rows={4}
                    onChange={(event) => updateCharacter(item.id, { prompt: event.target.value.slice(0, 1200) })}
                    className="mt-1 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
                  />
                </label>
                <button
                  type="button"
                  className="min-h-11 rounded-xl bg-ink px-3 text-sm font-medium text-paper"
                  onClick={() => {
                    const label = item.label.trim().slice(0, 24);
                    const prompt = item.prompt.trim().slice(0, 1200);
                    if (!label || !prompt) {
                      setError("角色名同 prompt 都不能留空。");
                      return;
                    }
                    updateCharacter(item.id, { label, prompt });
                    setEditingId(null);
                    setError("");
                  }}
                >
                  儲存修改
                </button>
              </div>
            ) : (
              <Chip
                seal="custom"
                pressed={!prefs.customOn && prefs.characterId === item.id}
                label={item.label}
                hint={item.prompt}
                onClick={() => patch({ characterId: item.id, customOn: false })}
              />
            )}
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-xl bg-sheet shadow-card"
                aria-label={`修改${item.label}`}
                onClick={() => setEditingId(editingId === item.id ? null : item.id)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-xl bg-sheet shadow-card"
                aria-label={`刪除${item.label}`}
                onClick={() => {
                  setRoster((current) => ({
                    ...current,
                    characters: current.characters.filter((row) => row.id !== item.id),
                  }));
                  if (editingId === item.id) setEditingId(null);
                  if (prefs.characterId === item.id) patch({ characterId: "", customOn: false });
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  function importCharacters() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setError("JSON 格式不正確。");
      return;
    }
    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { characters?: unknown }).characters)
        ? (parsed as { characters: unknown[] }).characters
        : parsed && typeof parsed === "object"
          ? [parsed]
          : [];
    const rows = source.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? row.label ?? "").trim().slice(0, 24);
      const prompt = String(row.prompt ?? "").trim().slice(0, 1200);
      const anime = String(row.anime ?? row.group ?? "").trim().slice(0, 32);
      return name && prompt ? [{ anime, name, prompt }] : [];
    });
    if (!rows.length) {
      setError("需要至少一個角色，並且有 name 同 prompt。");
      return;
    }
    const groups = [...roster.groups];
    const characters = [...roster.characters];
    let added = 0;
    let firstId = "";
    for (const row of rows) {
      if (characters.length >= 80) break;
      let groupId = "";
      if (row.anime) {
        const found = groups.find((group) => group.label === row.anime);
        if (found) groupId = found.id;
        else if (groups.length >= 12) continue;
        else {
          groupId = `grp-${crypto.randomUUID()}`;
          groups.push({ id: groupId, label: row.anime });
        }
      }
      const id = `mine-${crypto.randomUUID()}`;
      characters.unshift({ id, groupId, label: row.name, prompt: row.prompt });
      if (!firstId) firstId = id;
      added += 1;
    }
    if (!added) {
      setError("角色已滿 80 個，或者動漫分類已滿 12 個。");
      return;
    }
    setRoster((current) => ({ ...current, groups, characters }));
    setImportText("");
    setError("");
    setNotice(`已加入 ${added} 個角色。`);
    patch({ characterId: firstId, customOn: false });
  }

  function exportCharacters() {
    const rows = roster.characters.map((item) => ({
      anime: roster.groups.find((group) => group.id === item.groupId)?.label ?? "",
      name: item.label,
      prompt: item.prompt,
    }));
    if (!rows.length) {
      setError("還沒有角色可以匯出。");
      return;
    }
    const text = JSON.stringify(rows, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "huiye-characters.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setImportText(text);
    setError("");
    setNotice(`已匯出 ${rows.length} 個角色。檔案已下載，文字亦貼在下面。`);
  }

  function readSnippetImport(text: string, key: "outfits" | "actions") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "JSON 格式不正確。" } as const;
    }
    let source: unknown[] = [];
    if (Array.isArray(parsed)) source = parsed;
    else if (parsed && typeof parsed === "object") {
      const bag = parsed as Record<string, unknown>;
      if (Array.isArray(bag[key])) source = bag[key] as unknown[];
      else if (bag.name || bag.label || bag.prompt) source = [parsed];
    }
    const rows = source.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? row.label ?? "").trim().slice(0, 24);
      const prompt = String(row.prompt ?? "").trim().slice(0, 800);
      const part = clothPartOf(row.part);
      return name && prompt ? [{ name, prompt, part }] : [];
    });
    if (!rows.length) return { error: "需要至少一項，並且有 name 同 prompt。" } as const;
    return { rows } as const;
  }

  function mergeSnippets(current: Snippet[], rows: { name: string; prompt: string }[]) {
    const next = current.map((item) => ({ ...item }));
    let added = 0;
    let updated = 0;
    let firstId = "";
    for (const row of rows) {
      const found = next.find((item) => item.label === row.name);
      if (found) {
        found.prompt = row.prompt;
        updated += 1;
        if (!firstId) firstId = found.id;
        continue;
      }
      if (next.length >= 40) continue;
      const id = `snip-${crypto.randomUUID()}`;
      next.unshift({ id, label: row.name, prompt: row.prompt });
      added += 1;
      if (!firstId) firstId = id;
    }
    return { next, added, updated, firstId };
  }

  function downloadJson(filename: string, value: unknown) {
    const text = JSON.stringify(value, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return text;
  }

  function importOutfits() {
    const read = readSnippetImport(outfitImport, "outfits");
    if ("error" in read) {
      setError(read.error ?? "JSON 格式不正確。");
      return;
    }
    const groups = {
      set: mergeSnippets(prefs.outfits, read.rows.filter((row) => row.part === "set")),
      top: mergeSnippets(prefs.tops, read.rows.filter((row) => row.part === "top")),
      bottom: mergeSnippets(prefs.bottoms, read.rows.filter((row) => row.part === "bottom")),
      socks: mergeSnippets(prefs.socks, read.rows.filter((row) => row.part === "socks")),
    };
    const added = groups.set.added + groups.top.added + groups.bottom.added + groups.socks.added;
    const updated = groups.set.updated + groups.top.updated + groups.bottom.updated + groups.socks.updated;
    if (!added && !updated) {
      setError("衣服已滿，或者沒有可加入的項目。");
      return;
    }
    const pick = (merged: ReturnType<typeof mergeSnippets>, currentId: string, currentPrompt: string) => {
      const first = merged.next.find((item) => item.id === merged.firstId);
      if (!first || (!merged.added && !merged.updated)) return { id: currentId, prompt: currentPrompt };
      return { id: `saved:${first.id}`, prompt: first.prompt };
    };
    const hasParts = read.rows.some((row) => row.part !== "set");
    const setPick = pick(groups.set, prefs.outfitId, prefs.outfitPrompt);
    const topPick = pick(groups.top, prefs.topId, prefs.topPrompt);
    const bottomPick = pick(groups.bottom, prefs.bottomId, prefs.bottomPrompt);
    const sockPick = pick(groups.socks, prefs.sockId, prefs.sockPrompt);
    patch({
      outfits: groups.set.next,
      tops: groups.top.next,
      bottoms: groups.bottom.next,
      socks: groups.socks.next,
      clothMode: hasParts ? "parts" : "set",
      outfitId: setPick.id,
      outfitPrompt: setPick.prompt,
      topId: topPick.id,
      topPrompt: topPick.prompt,
      bottomId: bottomPick.id,
      bottomPrompt: bottomPick.prompt,
      sockId: sockPick.id,
      sockPrompt: sockPick.prompt,
    });
    setOutfitImport("");
    setError("");
    setNotice(`衣服：新增 ${added}，更新 ${updated}。`);
  }

  function exportOutfits() {
    const rows = [
      ...prefs.outfits.map((item) => ({ part: "set", name: item.label, prompt: item.prompt })),
      ...prefs.tops.map((item) => ({ part: "top", name: item.label, prompt: item.prompt })),
      ...prefs.bottoms.map((item) => ({ part: "bottom", name: item.label, prompt: item.prompt })),
      ...prefs.socks.map((item) => ({ part: "socks", name: item.label, prompt: item.prompt })),
    ];
    if (!rows.length && prefs.outfitPrompt.trim()) rows.push({ part: "set", name: "衣服", prompt: prefs.outfitPrompt.trim() });
    if (!rows.length) {
      setError("還沒有衣服可以匯出。");
      return;
    }
    const text = downloadJson("huiye-outfits.json", rows);
    setOutfitImport(text);
    setError("");
    setNotice(`已匯出 ${rows.length} 項衣服。`);
  }

  function addCloth() {
    const label = clothName.trim().slice(0, 24);
    const prompt = clothPrompt.trim().slice(0, 800);
    if (!label || !prompt) {
      setError("請填衣服名同 prompt。");
      return;
    }
    const item: Snippet = { id: `snip-${crypto.randomUUID()}`, label, prompt };
    if (clothPart === "set") {
      patch({ clothMode: "set", outfits: [item, ...prefs.outfits].slice(0, 40), outfitId: `saved:${item.id}`, outfitPrompt: prompt });
    } else if (clothPart === "top") {
      patch({ clothMode: "parts", tops: [item, ...prefs.tops].slice(0, 40), topId: `saved:${item.id}`, topPrompt: prompt });
    } else if (clothPart === "bottom") {
      patch({ clothMode: "parts", bottoms: [item, ...prefs.bottoms].slice(0, 40), bottomId: `saved:${item.id}`, bottomPrompt: prompt });
    } else {
      patch({ clothMode: "parts", socks: [item, ...prefs.socks].slice(0, 40), sockId: `saved:${item.id}`, sockPrompt: prompt });
    }
    setClothName("");
    setClothPrompt("");
    setError("");
    setNotice(`已加入${clothPart === "set" ? "整套" : clothPart === "top" ? "上衣" : clothPart === "bottom" ? "下身" : "襪子"}：${label}`);
  }

  function applySplit(split: ReturnType<typeof splitPrompt>) {
    if (!split.characters.length && !split.clothes.length && !split.actions.length && !split.scene && !split.style) {
      setError("認唔到角色或者衣服。請用逗號分開。");
      return false;
    }
    let firstCharacter = "";
    if (split.characters.length) {
      const characters = [...roster.characters];
      for (const person of split.characters) {
        const found = characters.find((item) => item.label === person.name);
        if (found) {
          characters[characters.indexOf(found)] = { ...found, prompt: person.prompt };
          if (!firstCharacter) firstCharacter = found.id;
        } else if (characters.length < 80) {
          const id = `mine-${crypto.randomUUID()}`;
          characters.unshift({ id, groupId: "", label: person.name, prompt: person.prompt });
          if (!firstCharacter) firstCharacter = id;
        }
      }
      setRoster((current) => ({ ...current, characters }));
    }
    const groups = {
      set: mergeSnippets(
        prefs.outfits,
        split.clothes.filter((item) => item.part === "set").map((item) => ({ name: item.name, prompt: item.prompt })),
      ),
      top: mergeSnippets(
        prefs.tops,
        split.clothes.filter((item) => item.part === "top").map((item) => ({ name: item.name, prompt: item.prompt })),
      ),
      bottom: mergeSnippets(
        prefs.bottoms,
        split.clothes.filter((item) => item.part === "bottom").map((item) => ({ name: item.name, prompt: item.prompt })),
      ),
      socks: mergeSnippets(
        prefs.socks,
        split.clothes.filter((item) => item.part === "socks").map((item) => ({ name: item.name, prompt: item.prompt })),
      ),
    };
    const actionRows =
      split.actions.length > 1
        ? [{ name: `${split.characters[0]?.name || "角色"} 全動作`.slice(0, 24), prompt: split.actions.map((item) => item.prompt).join(", ").slice(0, 800) }, ...split.actions]
        : split.actions;
    const actionGroup = mergeSnippets(
      prefs.actions,
      actionRows.map((item) => ({ name: item.name, prompt: item.prompt })),
    );
    const pick = (merged: ReturnType<typeof mergeSnippets>) => {
      const first = merged.next.find((item) => item.id === merged.firstId);
      return first && (merged.added || merged.updated) ? { id: `saved:${first.id}`, prompt: first.prompt } : null;
    };
    const setPick = pick(groups.set);
    const topPick = pick(groups.top);
    const bottomPick = pick(groups.bottom);
    const sockPick = pick(groups.socks);
    const actionPick = pick(actionGroup);
    const hasParts = split.clothes.some((item) => item.part !== "set");
    const sceneNote = [split.scene, ...split.characters.slice(1).map((item) => item.prompt)].filter(Boolean).join(", ").slice(0, 800);
    const styleText = split.style.trim();
    const extra = styleText && !prefs.extra.includes(styleText) ? [prefs.extra.trim(), styleText].filter(Boolean).join(", ") : prefs.extra;
    patch({
      outfits: groups.set.next,
      tops: groups.top.next,
      bottoms: groups.bottom.next,
      socks: groups.socks.next,
      actions: actionGroup.next,
      clothMode: hasParts ? "parts" : split.clothes.length ? "set" : prefs.clothMode,
      ...(setPick ? { outfitId: setPick.id, outfitPrompt: setPick.prompt } : {}),
      ...(topPick ? { topId: topPick.id, topPrompt: topPick.prompt } : {}),
      ...(bottomPick ? { bottomId: bottomPick.id, bottomPrompt: bottomPick.prompt } : {}),
      ...(sockPick ? { sockId: sockPick.id, sockPrompt: sockPick.prompt } : {}),
      ...(actionPick ? { actionId: actionPick.id, standPrompt: actionPick.prompt } : {}),
      ...(sceneNote ? { sceneId: "", sceneNote } : {}),
      ...(styleText.toLowerCase().includes("flatline") ? { styleId: "flatline" } : {}),
      ...(styleText ? { extra } : {}),
      ...(firstCharacter ? { characterId: firstCharacter, customOn: false } : {}),
    });
    setError("");
    setNotice(
      `已分析並保存：角色 ${split.characters.length}，整套 ${groups.set.added + groups.set.updated}，上衣 ${groups.top.added + groups.top.updated}，下身 ${groups.bottom.added + groups.bottom.updated}，襪子 ${groups.socks.added + groups.socks.updated}，動作 ${actionGroup.added + actionGroup.updated}。`,
    );
    return true;
  }

  function rememberPrompt(text: string, id: string | null) {
    const bits = text.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    const title = (bits.find((item) => !/^(1girl|1boy|solo|2girls)$/i.test(item)) || bits[0] || "未命名").slice(0, 24);
    const nextId = id && keptPrompts.some((item) => item.id === id) ? id : `prompt-${crypto.randomUUID()}`;
    setKeptPrompts((current) => {
      const row = { id: nextId, title, text: text.slice(0, 4000) };
      const rest = current.filter((item) => item.id !== nextId);
      return [row, ...rest].slice(0, 30);
    });
    setKeptId(nextId);
    return nextId;
  }

  function showPieces(text: string) {
    setPieces(promptPieces(text).map((piece) => ({ ...piece, id: crypto.randomUUID() })));
  }

  function saveAnalyzed(text: string, replaceId: string | null = keptId) {
    const split = splitPrompt(text);
    if (!applySplit(split)) return;
    rememberPrompt(text, replaceId);
    showPieces(text);
  }

  function applyEdited() {
    const usable = pieces.map((piece) => ({ ...piece, text: piece.text.trim() })).filter((piece) => piece.text);
    if (!usable.length) {
      setError("未有可以套用的內容。");
      return;
    }
    const text = usable.map((piece) => piece.text).join(", ");
    if (!applySplit(splitFromPieces(usable))) return;
    setRawPrompt(text);
    setPieces(usable);
    rememberPrompt(text, keptId);
  }

  function renderClothPart(part: "top" | "bottom" | "socks") {
    const spec =
      part === "top"
        ? { title: "上衣", items: prefs.tops, selected: prefs.topId, prompt: prefs.topPrompt, list: "tops" as const, idKey: "topId" as const, promptKey: "topPrompt" as const }
        : part === "bottom"
          ? { title: "下身", items: prefs.bottoms, selected: prefs.bottomId, prompt: prefs.bottomPrompt, list: "bottoms" as const, idKey: "bottomId" as const, promptKey: "bottomPrompt" as const }
          : { title: "襪子", items: prefs.socks, selected: prefs.sockId, prompt: prefs.sockPrompt, list: "socks" as const, idKey: "sockId" as const, promptKey: "sockPrompt" as const };
    return (
      <div className="mt-3">
        <h3 className="mb-2 text-xs text-muted">{spec.title}</h3>
        {spec.items.length ? (
          <ul className="grid grid-cols-1 gap-2">
            {spec.items.map((item) => (
              <li key={item.id} className="flex items-stretch gap-1">
                <Chip
                  seal="custom"
                  pressed={spec.selected === `saved:${item.id}`}
                  label={item.label}
                  hint={item.prompt}
                  onClick={() =>
                    patch(
                      spec.selected === `saved:${item.id}`
                        ? { [spec.idKey]: "", [spec.promptKey]: "" }
                        : { [spec.idKey]: `saved:${item.id}`, [spec.promptKey]: item.prompt },
                    )
                  }
                />
                <button
                  type="button"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sheet shadow-card"
                  aria-label={`刪除${spec.title}${item.label}`}
                  onClick={() =>
                    patch({
                      [spec.list]: spec.items.filter((row) => row.id !== item.id),
                      ...(spec.selected === `saved:${item.id}` ? { [spec.idKey]: "", [spec.promptKey]: "" } : {}),
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">未有{spec.title}。</p>
        )}
        {spec.selected ? (
          <textarea
            value={spec.prompt}
            onChange={(event) => {
              const prompt = event.target.value.slice(0, 800);
              const id = spec.selected.startsWith("saved:") ? spec.selected.slice(6) : "";
              patch({
                [spec.promptKey]: prompt,
                ...(id ? { [spec.list]: spec.items.map((item) => (item.id === id ? { ...item, prompt } : item)) } : {}),
              });
            }}
            rows={2}
            maxLength={800}
            className="mt-2 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
          />
        ) : null}
      </div>
    );
  }

  function importActions() {
    const read = readSnippetImport(actionImport, "actions");
    if ("error" in read) {
      setError(read.error ?? "JSON 格式不正確。");
      return;
    }
    const merged = mergeSnippets(prefs.actions, read.rows);
    if (!merged.added && !merged.updated) {
      setError("動作已滿 40 項。");
      return;
    }
    const first = merged.next.find((item) => item.id === merged.firstId);
    patch({
      actions: merged.next,
      actionId: first ? `saved:${first.id}` : prefs.actionId,
      standPrompt: first ? first.prompt : prefs.standPrompt,
    });
    setActionImport("");
    setError("");
    setNotice(`動作：新增 ${merged.added}，更新 ${merged.updated}。`);
  }

  function exportActions() {
    const rows = prefs.actions.length
      ? prefs.actions.map((item) => ({ name: item.label, prompt: item.prompt }))
      : prefs.actionId && prefs.standPrompt.trim()
        ? [{ name: prefs.actionId === "stand" ? "絕對站立" : "動作", prompt: prefs.standPrompt.trim() }]
        : [];
    if (!rows.length) {
      setError("還沒有動作可以匯出。");
      return;
    }
    const text = downloadJson("huiye-actions.json", rows);
    setActionImport(text);
    setError("");
    setNotice(`已匯出 ${rows.length} 項動作。`);
  }

  function characterDraft(groupId: string) {
    if (addingGroupId !== groupId) {
      return (
        <button
          type="button"
          className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-cinnabar"
          onClick={() => {
            setAddingGroupId(groupId);
            setDraftName("");
            setDraftPrompt("");
          }}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          加入角色
        </button>
      );
    }
    return (
      <form
        className="mt-2 space-y-2 rounded-xl bg-paper p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const label = draftName.trim().slice(0, 24);
          const prompt = draftPrompt.trim().slice(0, 1200);
          if (!label || !prompt) {
            setError("請填角色名同 prompt。");
            return;
          }
          const item: SavedCharacter = {
            id: `mine-${crypto.randomUUID()}`,
            groupId,
            label,
            prompt,
          };
          setRoster((current) => ({
            ...current,
            characters: [item, ...current.characters].slice(0, 80),
          }));
          setDraftName("");
          setDraftPrompt("");
          setAddingGroupId(null);
          setError("");
          patch({ characterId: item.id, customOn: false });
        }}
      >
        <label className="block text-sm">
          角色名稱
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            maxLength={24}
            placeholder="角色名稱"
            className="mt-1 h-11 w-full rounded-xl border border-line bg-sheet px-3 text-sm outline-none focus-visible:border-cinnabar"
          />
        </label>
        <label className="block text-sm">
          角色 prompt
          <textarea
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            rows={3}
            maxLength={1200}
            placeholder="外貌同標籤，例如 1girl, silver hair, blue eyes"
            className="mt-1 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-3 text-sm font-medium text-paper"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            加入角色
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl px-3 text-sm text-muted"
            onClick={() => setAddingGroupId(null)}
          >
            取消
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="min-h-screen bg-paper pb-28 text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              className="grid size-12 place-items-center rounded-2xl bg-cinnabar font-serif text-xl text-cinnabar-ink shadow-card"
              aria-hidden="true"
            >
              繪
            </span>
            <div>
              <p className="text-xs tracking-widest text-muted">PIXAI ATELIER</p>
              <h1 className="text-3xl leading-none">繪夜</h1>
            </div>
          </div>
          <p className="max-w-md text-sm text-muted">
            選好自己的角色，用你的 PixAI 金鑰出圖。圖會留在這台裝置，也可以存進 Google Drive。
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-card bg-sheet p-3 shadow-card sm:p-4">
            <div
              className={
                "flex items-center justify-center overflow-hidden rounded-2xl bg-paper " +
                (activeUrl ? "aspect-[3/4] max-h-[70vh]" : "h-40 sm:h-52")
              }
            >
              {activeUrl ? (
                <img src={activeUrl} alt={active?.title || "生成的圖片"} className="h-full w-full object-contain" />
              ) : (
                <div className="px-8 text-center">
                  <p className="font-serif text-2xl">還沒有作品</p>
                  <p className="mt-2 text-sm text-muted">選好造型後按「開始繪製」。生成會使用你的 PixAI 點數。</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm" aria-live="polite">
                <span className="font-medium">{active?.title || statusText}</span>
                {phaseJobs.length ? (
                  <span className="mt-1 block space-y-1 text-muted">
                    {phaseJobs.map((job) => (
                      <span key={job.id} className="flex items-center gap-1 tabular-nums">
                        <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                        <span className="min-w-0 truncate">
                          {job.label} · {job.status} {Math.max(0, Math.floor((now - job.started) / 1000))}s
                        </span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => void onSaveDrive()}
                disabled={!active || driveBusy}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cinnabar px-3 text-sm font-medium text-cinnabar-ink disabled:opacity-40"
              >
                <CloudUpload className="size-4" aria-hidden="true" />
                存到 Google Drive
              </button>
              <button
                type="button"
                onClick={downloadActive}
                disabled={!active}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-paper px-3 text-sm shadow-card disabled:opacity-40"
              >
                <Download className="size-4" aria-hidden="true" />
                下載
              </button>
              <button
                type="button"
                onClick={() => void removeActive()}
                disabled={!active}
                className="inline-flex size-11 items-center justify-center rounded-xl bg-paper shadow-card disabled:opacity-40"
                aria-label="從圖庫刪除"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
            {error ? (
              <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-cinnabar">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-muted">
                <Check className="mt-0.5 size-4 shrink-0 text-cinnabar" aria-hidden="true" />
                {notice}
              </p>
            ) : null}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Images className="size-4" aria-hidden="true" />
                這台裝置的圖庫
              </h2>
              <button
                type="button"
                onClick={() => void refreshDrive()}
                disabled={driveBusy}
                className="inline-flex min-h-11 items-center gap-2 text-sm text-muted disabled:opacity-40"
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                查看 Drive 圖庫
              </button>
            </div>
            {works.length ? (
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {works.map((work) => (
                  <li key={work.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(work.id)}
                      aria-pressed={work.id === activeId}
                      className={
                        "block w-full overflow-hidden rounded-xl bg-sheet shadow-card " +
                        (work.id === activeId ? "outline outline-2 outline-cinnabar" : "")
                      }
                    >
                      {urls[work.id] ? (
                        <img src={urls[work.id]} alt="" className="aspect-square w-full object-cover" />
                      ) : (
                        <span className="block aspect-square" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">圖庫是空的。完成的圖會自動留在這裡，重新整理也不會消失。</p>
            )}
            {driveFiles ? (
              <ul className="mt-3 space-y-1">
                {driveFiles.length ? (
                  driveFiles.map((file) => (
                    <li key={file.id} className="text-sm">
                      {file.link ? (
                        <a href={file.link} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4">
                          {file.name}
                        </a>
                      ) : (
                        <span>{file.name}</span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted">Drive 資料夾裡還沒有檔案。</li>
                )}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-card bg-sheet p-4 shadow-card">
            <FieldLabel>PixAI 金鑰</FieldLabel>
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">PixAI API 金鑰</span>
                <KeyRound className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden="true" />
                <input
                  value={prefs.apiKey}
                  onChange={(event) => setPrefs((current) => ({ ...current, apiKey: event.target.value }))}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="貼上 API 金鑰"
                  className="h-11 w-full rounded-xl border border-line bg-paper pr-3 pl-10 text-sm outline-none focus-visible:border-cinnabar"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="inline-flex size-11 items-center justify-center rounded-xl bg-paper shadow-card"
                aria-label={showKey ? "隱藏金鑰" : "顯示金鑰"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              金鑰只存在這台裝置，用來代你呼叫 PixAI，不會寫進資料庫。可在{" "}
              <a
                className="underline decoration-line underline-offset-4"
                href="https://pixai.art/profile/edit/api"
                target="_blank"
                rel="noreferrer"
              >
                PixAI 個人檔案
              </a>{" "}
              建立。
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPanel("character")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">角色</span>
            <span className="min-w-0 truncate text-sm text-muted">{selectedOwn?.label || (prefs.customOn ? "臨時描述" : "未選")}</span>
          </button>
          {panel === "character" ? (
          <DialogFrame title="角色" onClose={() => setPanel(null)}>
            {roster.groups.map((group) => (
              <section key={group.id} className="mt-4">
                <div className="mb-2 flex items-center gap-1">
                  <input
                    value={group.label}
                    maxLength={32}
                    aria-label="動漫名稱"
                    placeholder="動漫名稱"
                    onChange={(event) =>
                      setRoster((current) => ({
                        ...current,
                        groups: current.groups.map((row) =>
                          row.id === group.id ? { ...row, label: event.target.value } : row,
                        ),
                      }))
                    }
                    onBlur={() =>
                      setRoster((current) => ({
                        ...current,
                        groups: current.groups.map((row) =>
                          row.id === group.id
                            ? { ...row, label: row.label.trim().slice(0, 32) || "未命名動漫" }
                            : row,
                        ),
                      }))
                    }
                    className="h-11 min-w-0 flex-1 border-b border-line bg-transparent text-xs text-muted outline-none"
                  />
                  <button
                    type="button"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted"
                    aria-label={`刪除動漫${group.label}`}
                    onClick={() => {
                      setRoster((current) => ({
                        ...current,
                        groups: current.groups.filter((row) => row.id !== group.id),
                        characters: current.characters.map((row) =>
                          row.groupId === group.id ? { ...row, groupId: "" } : row,
                        ),
                      }));
                      if (addingGroupId === group.id) setAddingGroupId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                {characterList(group.id) ?? <p className="text-xs text-muted">這個動漫還沒有角色。</p>}
                {characterDraft(group.id)}
              </section>
            ))}
            <button
              type="button"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-sheet px-3 text-sm font-medium shadow-card"
              onClick={() => {
                if (roster.groups.length >= 12) return;
                const id = `grp-${crypto.randomUUID()}`;
                setRoster((current) => ({
                  ...current,
                  groups: [...current.groups, { id, label: "" }],
                }));
              }}
            >
              新增動漫
            </button>
            <section className="mt-4">
              <h3 className="mb-2 text-xs text-muted">沒有動漫名稱</h3>
              {characterList("") ?? <p className="text-xs text-muted">可以直接加角色，唔使填動漫名。</p>}
              {characterDraft("")}
            </section>
            <p className="mt-2 text-xs text-muted">先填動漫名稱，再加角色名稱。角色亦可以唔歸任何動漫。只留喺呢部裝置。</p>
            <details className="mt-3 rounded-card bg-sheet p-4 shadow-card">
              <summary className="min-h-11 cursor-pointer text-sm font-medium">一鍵加入 JSON</summary>
              <p className="mt-2 text-xs text-muted">anime 可以留空。name 也可以寫成 label。</p>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={'[\n  { "anime": "動漫名稱", "name": "角色名稱", "prompt": "1girl, silver hair" },\n  { "anime": "", "name": "沒有動漫的角色", "prompt": "1girl, black hair" }\n]'}
                className="mt-2 w-full rounded-xl border border-line bg-paper p-3 font-mono text-xs outline-none focus-visible:border-cinnabar"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importCharacters}
                  className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper"
                >
                  一鍵加入
                </button>
                <button
                  type="button"
                  onClick={exportCharacters}
                  className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-medium shadow-card"
                >
                  匯出 JSON
                </button>
              </div>
            </details>
            <div className="mt-2">
              <Chip
                seal="custom"
                pressed={prefs.customOn}
                label="臨時描述"
                hint="只用於這一次，不儲存"
                onClick={() => patch({ customOn: true })}
              />
            </div>
            {prefs.customOn ? (
              <textarea
                value={prefs.customCharacter}
                onChange={(event) => patch({ customCharacter: event.target.value })}
                rows={3}
                placeholder="例如：短黑髮、綠色眼睛、左耳有小銀環的少女"
                className="mt-2 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
              />
            ) : null}
          </DialogFrame>
          ) : null}

          <button
            type="button"
            onClick={() => setPanel("analyze")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">分析 prompt</span>
            <span className="min-w-0 truncate text-sm text-muted">
              {(keptId && keptPrompts.find((item) => item.id === keptId)?.title) || (keptPrompts[0]?.title ?? "未保存")}
            </span>
          </button>
          {panel === "analyze" ? (
          <DialogFrame title="分析 prompt" onClose={() => setPanel(null)}>
            <p className="mb-2 text-xs text-muted">貼上或者上傳一段 prompt。可以保存成段，再開返出嚟改其中一部分，然後再分開。</p>
            <textarea
              value={rawPrompt}
              onChange={(event) => setRawPrompt(event.target.value.slice(0, 4000))}
              rows={4}
              maxLength={4000}
              placeholder="角色名, pink school jacket, white blouse, red bow, short blue skirt, white thigh-high socks"
              className="w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
            />
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => {
                  const next = text.slice(0, 4000);
                  setRawPrompt(next);
                  saveAnalyzed(next, null);
                });
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveAnalyzed(rawPrompt)}
                className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper"
              >
                分析並保存
              </button>
              <button
                type="button"
                onClick={() => showPieces(rawPrompt)}
                className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-medium shadow-card"
              >
                再次分開
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-medium shadow-card"
              >
                上傳文字檔
              </button>
            </div>
            {pieces.length ? (
              <ul className="mt-3 space-y-2">
                {pieces.map((piece) => (
                  <li key={piece.id} className="flex items-center gap-1">
                    <select
                      value={piece.kind}
                      aria-label="這一段的分類"
                      onChange={(event) =>
                        setPieces((current) =>
                          current.map((item) => (item.id === piece.id ? { ...item, kind: event.target.value as PieceKind } : item)),
                        )
                      }
                      className="h-11 w-[4.75rem] shrink-0 rounded-xl border border-line bg-paper px-2 text-sm outline-none focus-visible:border-cinnabar"
                    >
                      <option value="who">角色</option>
                      <option value="look">外貌</option>
                      <option value="top">上衣</option>
                      <option value="bottom">下身</option>
                      <option value="socks">襪子</option>
                      <option value="shoes">鞋子</option>
                      <option value="set">整套</option>
                      <option value="act">動作</option>
                      <option value="scene">場景</option>
                      <option value="style">畫風</option>
                    </select>
                    <input
                      value={piece.text}
                      aria-label="這一段的內容"
                      onChange={(event) =>
                        setPieces((current) => current.map((item) => (item.id === piece.id ? { ...item, text: event.target.value.slice(0, 800) } : item)))
                      }
                      className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-sheet px-3 text-sm outline-none focus-visible:border-cinnabar"
                    />
                    <button
                      type="button"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sheet shadow-card"
                      aria-label="刪除這一段"
                      onClick={() => setPieces((current) => current.filter((item) => item.id !== piece.id))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {pieces.length ? (
              <button
                type="button"
                onClick={applyEdited}
                className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper"
              >
                套用修改
              </button>
            ) : null}
            {keptPrompts.length ? (
              <div className="mt-3">
                <h3 className="mb-2 text-xs text-muted">已保存的 prompt</h3>
                <ul className="space-y-2">
                  {keptPrompts.map((item) => (
                    <li key={item.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setKeptId(item.id);
                          setRawPrompt(item.text);
                          showPieces(item.text);
                        }}
                        className={
                          "min-h-11 min-w-0 flex-1 rounded-xl px-3 text-left text-sm " +
                          (keptId === item.id ? "bg-ink text-paper" : "bg-paper shadow-card")
                        }
                      >
                        <span className="block truncate font-medium">{item.title}</span>
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sheet shadow-card"
                        aria-label={`刪除 prompt ${item.title}`}
                        onClick={() => {
                          setKeptPrompts((current) => current.filter((row) => row.id !== item.id));
                          if (keptId === item.id) setKeptId(null);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </DialogFrame>
          ) : null}

          <button
            type="button"
            onClick={() => setPanel("clothes")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">衣服</span>
            <span className="min-w-0 truncate text-sm text-muted">{pieceLabel || "未選"}</span>
          </button>
          {panel === "clothes" ? (
          <DialogFrame title="衣服" onClose={() => setPanel(null)}>
            <div className="grid grid-cols-2 gap-2">
              <Chip pressed={prefs.clothMode === "set"} label="整套" hint="一次用成套衣服" onClick={() => patch({ clothMode: "set" })} />
              <Chip
                pressed={prefs.clothMode === "parts"}
                label="分開選"
                hint="上衣、下身、襪子"
                onClick={() => patch({ clothMode: "parts" })}
              />
            </div>
            {prefs.clothMode === "set" ? (
            <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OUTFITS.map((item) => (
                <Chip
                  key={item.id}
                  pressed={prefs.outfitId === item.id}
                  label={item.label}
                  hint={item.hint}
                  onClick={() =>
                    patch(
                      prefs.outfitId === item.id
                        ? { outfitId: "", outfitPrompt: "" }
                        : { outfitId: item.id, outfitPrompt: item.prompt },
                    )
                  }
                />
              ))}
              <Chip
                seal="custom"
                pressed={prefs.outfitId === "custom"}
                label="自訂"
                hint="自己改 prompt"
                onClick={() =>
                  patch(
                    prefs.outfitId === "custom"
                      ? { outfitId: "", outfitPrompt: "" }
                      : { outfitId: "custom", outfitPrompt: prefs.outfitPrompt },
                  )
                }
              />
            </div>
            {prefs.outfits.length ? (
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {prefs.outfits.map((item) => (
                  <li key={item.id} className="flex items-stretch gap-1">
                    <Chip
                      seal="custom"
                      pressed={prefs.outfitId === `saved:${item.id}`}
                      label={item.label}
                      hint={item.prompt}
                      onClick={() =>
                        patch(
                          prefs.outfitId === `saved:${item.id}`
                            ? { outfitId: "", outfitPrompt: "" }
                            : { outfitId: `saved:${item.id}`, outfitPrompt: item.prompt },
                        )
                      }
                    />
                    <button
                      type="button"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sheet shadow-card"
                      aria-label={`刪除衣服${item.label}`}
                      onClick={() => {
                        patch({
                          outfits: prefs.outfits.filter((row) => row.id !== item.id),
                          ...(prefs.outfitId === `saved:${item.id}` ? { outfitId: "", outfitPrompt: "" } : {}),
                        });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {prefs.outfitId ? (
              <textarea
                value={prefs.outfitPrompt}
                onChange={(event) => {
                  const prompt = event.target.value.slice(0, 800);
                  const id = prefs.outfitId.startsWith("saved:") ? prefs.outfitId.slice(6) : "";
                  patch({
                    outfitPrompt: prompt,
                    ...(id
                      ? { outfits: prefs.outfits.map((item) => (item.id === id ? { ...item, prompt } : item)) }
                      : {}),
                  });
                }}
                rows={3}
                maxLength={800}
                placeholder="衣服 prompt，例如 sailor uniform, blue skirt"
                className="mt-2 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
              />
            ) : (
              <p className="mt-2 text-xs text-muted">未選整套。揀一項之後可以改 prompt。</p>
            )}
            </>
            ) : (
              <>
                {renderClothPart("top")}
                {renderClothPart("bottom")}
                {renderClothPart("socks")}
              </>
            )}
            <form
              className="mt-3 space-y-2 rounded-xl bg-paper p-3"
              onSubmit={(event) => {
                event.preventDefault();
                addCloth();
              }}
            >
              <p className="text-sm font-medium">新增衣服</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["set", "整套"],
                    ["top", "上衣"],
                    ["bottom", "下身"],
                    ["socks", "襪子"],
                  ] as const
                ).map(([id, label]) => (
                  <Chip key={id} pressed={clothPart === id} label={label} hint="" onClick={() => setClothPart(id)} />
                ))}
              </div>
              <input
                value={clothName}
                onChange={(event) => setClothName(event.target.value)}
                maxLength={24}
                placeholder="名稱，例如粉紅校服"
                className="h-11 w-full rounded-xl border border-line bg-sheet px-3 text-sm outline-none focus-visible:border-cinnabar"
              />
              <textarea
                value={clothPrompt}
                onChange={(event) => setClothPrompt(event.target.value)}
                rows={3}
                maxLength={800}
                placeholder="prompt，例如 pink school jacket, white blouse, red bow"
                className="w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
              />
              <button type="submit" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper">
                加入
              </button>
            </form>
            <details className="mt-3 rounded-card bg-sheet p-4 shadow-card">
              <summary className="min-h-11 cursor-pointer text-sm font-medium">衣服 JSON</summary>
              <textarea
                value={outfitImport}
                onChange={(event) => setOutfitImport(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={'[\n  { "part": "set", "name": "粉紅校服", "prompt": "pink school jacket, white blouse with a red bow, short blue skirt, white thigh-high socks with a blue stripe" },\n  { "part": "top", "name": "粉紅外套", "prompt": "pink school jacket, white blouse, red bow" },\n  { "part": "bottom", "name": "藍短裙", "prompt": "short blue skirt" },\n  { "part": "socks", "name": "白過膝襪", "prompt": "white thigh-high socks, blue stripe" }\n]'}
                className="mt-2 w-full rounded-xl border border-line bg-paper p-3 font-mono text-xs outline-none focus-visible:border-cinnabar"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importOutfits}
                  className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper"
                >
                  匯入
                </button>
                <button
                  type="button"
                  onClick={exportOutfits}
                  className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-medium shadow-card"
                >
                  匯出
                </button>
              </div>
            </details>
          </DialogFrame>
          ) : null}

          <button
            type="button"
            onClick={() => setPanel("action")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">動作</span>
            <span className="min-w-0 truncate text-sm text-muted">
              {prefs.actionId === "stand"
                ? "絕對站立"
                : (prefs.actions.find((item) => prefs.actionId === `saved:${item.id}`)?.label ?? "未選")}
            </span>
          </button>
          {panel === "action" ? (
          <DialogFrame title="動作" onClose={() => setPanel(null)}>
            <Chip
              pressed={prefs.actionId === "stand"}
              label="絕對站立"
              hint="正面全身，雙手垂下，赤腳"
              onClick={() => {
                if (prefs.actionId === "stand") patch({ actionId: "" });
                else patch({ actionId: "stand", standPrompt: prefs.actionId.startsWith("saved:") ? STAND.tags : prefs.standPrompt || STAND.tags });
              }}
            />
            {prefs.actions.length ? (
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {prefs.actions.map((item) => (
                  <li key={item.id} className="flex items-stretch gap-1">
                    <Chip
                      seal="custom"
                      pressed={prefs.actionId === `saved:${item.id}`}
                      label={item.label}
                      hint={item.prompt}
                      onClick={() =>
                        patch(
                          prefs.actionId === `saved:${item.id}`
                            ? { actionId: "", standPrompt: "" }
                            : { actionId: `saved:${item.id}`, standPrompt: item.prompt },
                        )
                      }
                    />
                    <button
                      type="button"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sheet shadow-card"
                      aria-label={`刪除動作${item.label}`}
                      onClick={() => {
                        patch({
                          actions: prefs.actions.filter((row) => row.id !== item.id),
                          ...(prefs.actionId === `saved:${item.id}` ? { actionId: "", standPrompt: "" } : {}),
                        });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {prefs.actionId ? (
              <textarea
                value={prefs.standPrompt}
                onChange={(event) => {
                  const prompt = event.target.value.slice(0, 800);
                  const id = prefs.actionId.startsWith("saved:") ? prefs.actionId.slice(6) : "";
                  patch({
                    standPrompt: prompt,
                    ...(id ? { actions: prefs.actions.map((item) => (item.id === id ? { ...item, prompt } : item)) } : {}),
                  });
                }}
                rows={3}
                maxLength={800}
                className="mt-2 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
              />
            ) : null}
            <details className="mt-3 rounded-card bg-sheet p-4 shadow-card">
              <summary className="min-h-11 cursor-pointer text-sm font-medium">動作 JSON</summary>
              <textarea
                value={actionImport}
                onChange={(event) => setActionImport(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={'[\n  { "name": "絕對站立", "prompt": "standing, full body, front view" }\n]'}
                className="mt-2 w-full rounded-xl border border-line bg-paper p-3 font-mono text-xs outline-none focus-visible:border-cinnabar"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importActions}
                  className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-sm font-medium text-paper"
                >
                  匯入
                </button>
                <button
                  type="button"
                  onClick={exportActions}
                  className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-medium shadow-card"
                >
                  匯出
                </button>
              </div>
            </details>
          </DialogFrame>
          ) : null}

          <button
            type="button"
            onClick={() => setPanel("scene")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">場景</span>
            <span className="min-w-0 truncate text-sm text-muted">
              {prefs.sceneId === "blank" ? "空白背景" : prefs.sceneNote.trim().slice(0, 18) || "未選"}
            </span>
          </button>
          {panel === "scene" ? (
          <DialogFrame title="場景" onClose={() => setPanel(null)}>
            <Chip
              pressed={prefs.sceneId === "blank"}
              label="空白背景"
              hint="純白，沒有景物"
              onClick={() => patch({ sceneId: prefs.sceneId === "blank" ? "" : "blank" })}
            />
            {prefs.sceneId === "blank" ? (
              <textarea
                value={prefs.blankPrompt}
                onChange={(event) => patch({ blankPrompt: event.target.value.slice(0, 800) })}
                rows={2}
                maxLength={800}
                className="mt-2 w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
              />
            ) : null}
          </DialogFrame>
          ) : null}

          <button
            type="button"
            onClick={() => setPanel("setup")}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-sheet px-3 text-left shadow-card"
          >
            <span className="text-sm font-medium">出圖設定</span>
            <span className="min-w-0 truncate text-sm text-muted">
              {(STYLES.find((item) => item.id === prefs.styleId) ?? STYLES[0]).label} · {prefs.aspect}
            </span>
          </button>
          {panel === "setup" ? (
          <DialogFrame title="出圖設定" onClose={() => setPanel(null)}>
          <div>
            <FieldLabel>畫風</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {STYLES.map((item) => (
                <Chip
                  key={item.id}
                  pressed={prefs.styleId === item.id}
                  label={item.label}
                  hint={item.hint}
                  onClick={() => patch({ styleId: item.id })}
                />
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>比例</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {ASPECTS.map((item) => (
                <Chip
                  key={item.id}
                  pressed={prefs.aspect === item.id}
                  label={item.label}
                  hint={item.hint}
                  onClick={() => patch({ aspect: item.id })}
                />
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>模型</FieldLabel>
            <div className="grid gap-2">
              {MODELS.map((item) => (
                <Chip
                  key={item.id}
                  pressed={prefs.modelId === item.id}
                  label={item.label}
                  hint={item.note}
                  onClick={() => patch({ modelId: item.id })}
                />
              ))}
            </div>
          </div>

          <details className="rounded-card bg-sheet p-4 shadow-card">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">進階：畫質、張數、種子</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Chip pressed={prefs.size === "1k"} label="標準" hint="1k" onClick={() => patch({ size: "1k" })} />
                <Chip
                  pressed={prefs.size === "1.5k"}
                  label="細緻"
                  hint="1.5k・較耗點數"
                  onClick={() => patch({ size: "1.5k" })}
                />
                <Chip pressed={prefs.batch === 1} label="1 張" hint="預設" onClick={() => patch({ batch: 1 })} />
                <Chip pressed={prefs.batch === 4} label="4 張" hint="一次四張" onClick={() => patch({ batch: 4 })} />
              </div>
              {model.family === "dit" ? (
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((item) => (
                    <Chip
                      key={item.id}
                      pressed={prefs.mode === item.id}
                      label={item.label}
                      hint={item.hint}
                      onClick={() => patch({ mode: item.id })}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">這個模型不使用 Tsubaki 的 Lite / Ultra 模式。</p>
              )}
              <label className="block text-sm">
                種子（可留空）
                <input
                  value={prefs.seed}
                  onChange={(event) => setPrefs((current) => ({ ...current, seed: event.target.value }))}
                  inputMode="numeric"
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus-visible:border-cinnabar"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.promptHelper}
                  onChange={(event) => patch({ promptHelper: event.target.checked })}
                  className="size-4 accent-cinnabar"
                />
                提示詞助手（可能改寫描述，角色會比較不穩）
              </label>
              <label className="block text-sm">
                補充描述
                <textarea
                  value={prefs.extra}
                  onChange={(event) => patch({ extra: event.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-line bg-paper p-3 text-sm outline-none focus-visible:border-cinnabar"
                />
              </label>
              <label className="block text-sm">
                負面提示
                <textarea
                  value={prefs.negative}
                  onChange={(event) => setPrefs((current) => ({ ...current, negative: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-line bg-paper p-3 text-sm outline-none focus-visible:border-cinnabar"
                />
              </label>
            </div>
          </details>
          </DialogFrame>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <FieldLabel>送給 PixAI 的提示詞</FieldLabel>
              {promptOverride !== null ? (
                <button type="button" className="text-xs text-muted underline" onClick={() => setPromptOverride(null)}>
                  改回選項
                </button>
              ) : null}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPromptOverride(event.target.value)}
              rows={6}
              className="w-full rounded-xl border border-line bg-sheet p-3 text-sm outline-none focus-visible:border-cinnabar"
            />
            <p className="mt-2 text-xs text-muted">手動改過會留喺呢部裝置。改上面嘅選項會改回自動拼出嚟。</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={phaseJobs.length >= 4}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-medium text-paper disabled:opacity-50"
            >
              {phaseJobs.length ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              {phaseJobs.length ? `再繪一張（${phaseJobs.length}/4）` : "開始繪製"}
            </button>
            {phaseJobs.length ? (
              <button
                type="button"
                onClick={() => {
                  for (const job of jobsRef.current.values()) job.cancel = true;
                }}
                className="min-h-12 rounded-2xl bg-sheet px-4 text-sm shadow-card"
              >
                停止等待
              </button>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
