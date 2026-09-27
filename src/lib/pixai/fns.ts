import { createServerFn } from "@tanstack/react-start";
import { MODELS } from "./catalog";

const PIXAI = "https://api.pixai.art";
const ASPECTS = new Set(["1:1", "3:4", "2:3", "9:16", "4:3", "16:9", "3:5", "5:3", "3:2"]);
const MODES = new Set(["lite", "standard", "pro", "ultra"]);
const FOLDER_NAME = "繪夜圖庫";
const MAX_BYTES = 7_000_000;

type Fail = {
  ok: false;
  error: string;
  loginRequired?: boolean;
  loginUrl?: string;
  pending?: boolean;
};

function fail(error: string, extra?: Omit<Fail, "ok" | "error">): Fail {
  return { ok: false, error, ...extra };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (key.length < 8 || key.length > 400) return null;
  if (/[\r\n]/.test(key)) return null;
  return key;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return id;
}

async function pixai(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${PIXAI}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

function apiError(status: number, json: unknown, text: string): string {
  if (status === 401) return "PixAI 金鑰無效，或這個帳號還沒有 API 權限。";
  if (status === 402 || status === 429) return "PixAI 點數不足，或請求太頻繁。請稍後再試。";
  if (isRecord(json)) {
    const message =
      str(json.message) ||
      str(json.error) ||
      str(json.detail) ||
      (isRecord(json.error) ? str(json.error.message) : null);
    if (message) return message.slice(0, 400);
  }
  const clipped = text.replace(/\s+/g, " ").slice(0, 280);
  return clipped || `PixAI 回應 HTTP ${status}`;
}

export type TaskView = {
  ok: true;
  taskId: string;
  status: string;
  mediaIds: string[];
  error?: string;
};

function readTask(json: unknown, fallbackId: string): TaskView | Fail {
  if (!isRecord(json)) return fail("PixAI 沒有回傳任務資料。");
  const taskId = str(json.id) ?? fallbackId;
  const status = str(json.status) ?? "waiting";
  const outputs = isRecord(json.outputs) ? json.outputs : {};
  const mediaIds = Array.isArray(outputs.mediaIds)
    ? outputs.mediaIds.filter((id): id is string => typeof id === "string")
    : [];
  const message =
    str(json.error) ||
    str(json.message) ||
    (isRecord(outputs) ? str(outputs.error) || str(outputs.message) : null);
  return {
    ok: true,
    taskId,
    status,
    mediaIds,
    ...(message ? { error: message } : {}),
  };
}

export const createGeneration = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isRecord(data)) throw new Error("請求格式不正確");
    const apiKey = cleanKey(data.apiKey);
    if (!apiKey) throw new Error("請貼上有效的 PixAI API 金鑰");
    const model = MODELS.find((item) => item.id === data.modelId);
    if (!model) throw new Error("請選擇模型");
    const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
    if (prompt.length < 2 || prompt.length > 3500) throw new Error("提示詞長度需要在 2 到 3500 字之間");
    const negative =
      typeof data.negative === "string" ? data.negative.trim().slice(0, 1200) : "";
    const aspect = typeof data.aspect === "string" ? data.aspect : "3:4";
    if (!ASPECTS.has(aspect)) throw new Error("不支援的比例");
    const size = data.size === "1.5k" ? "1.5k" : "1k";
    const batch = data.batch === 4 ? 4 : 1;
    const mode = typeof data.mode === "string" && MODES.has(data.mode) ? data.mode : "standard";
    const promptHelper = data.promptHelper === true;
    let seed: number | undefined;
    if (typeof data.seed === "string" && data.seed.trim()) {
      const parsed = Number(data.seed.trim());
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
        throw new Error("種子必須是 0 到 2147483647 的整數");
      }
      seed = parsed;
    }
    return { apiKey, model, prompt, negative, aspect, size, batch, mode, promptHelper, seed };
  })
  .handler(async ({ data }): Promise<{ ok: true; taskId: string; status: string } | Fail> => {
    try {
      const send = (body: Record<string, unknown>) =>
        pixai("/v2/image/create", data.apiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const full: Record<string, unknown> = {
        modelVersionId: data.model.versionId,
        prompt: data.prompt,
        aspectRatio: data.aspect,
        size: data.size,
        batchSize: data.batch,
        promptHelper: data.promptHelper,
      };
      if (data.negative) full.negativePrompt = data.negative;
      if (data.model.family === "dit") full.mode = data.mode;
      if (data.seed !== undefined) full.seed = data.seed;

      let res = await send(full);
      if (res.status === 400) {
        const minimal: Record<string, unknown> = {
          modelVersionId: data.model.versionId,
          prompt: data.prompt,
          aspectRatio: data.aspect,
          batchSize: data.batch,
        };
        if (data.model.family === "dit") minimal.mode = data.mode;
        res = await send(minimal);
      }
      if (res.status >= 400) return fail(apiError(res.status, res.json, res.text));
      const task = readTask(res.json, "");
      if (!task.ok) return task;
      if (!task.taskId) return fail("PixAI 沒有回傳任務編號。");
      return { ok: true, taskId: task.taskId, status: task.status };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "無法連上 PixAI");
    }
  });

export const pollGeneration = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isRecord(data)) throw new Error("請求格式不正確");
    const apiKey = cleanKey(data.apiKey);
    const taskId = cleanId(data.taskId);
    if (!apiKey || !taskId) throw new Error("任務資料不完整");
    return { apiKey, taskId };
  })
  .handler(async ({ data }): Promise<TaskView | Fail> => {
    try {
      const res = await pixai(`/v1/task/${data.taskId}`, data.apiKey);
      if (res.status >= 400) return fail(apiError(res.status, res.json, res.text));
      return readTask(res.json, data.taskId);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "查詢任務失敗");
    }
  });

async function readLimited(res: Response): Promise<{ bytes: Buffer; mime: string }> {
  const mimeHeader = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  if (!res.body) throw new Error("PixAI 沒有回傳圖片內容");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("圖片超過可保存的大小");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.byteLength) throw new Error("圖片是空的");
  const mime = mimeHeader.startsWith("image/") ? mimeHeader : "image/png";
  return { bytes, mime };
}

async function downloadMedia(apiKey: string, mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
  const meta = await pixai(`/v1/media/${mediaId}`, apiKey);
  if (meta.status < 400 && isRecord(meta.json)) {
    const urls = Array.isArray(meta.json.urls) ? meta.json.urls : [];
    const fromList = urls
      .map((item) => (isRecord(item) ? str(item.url) : null))
      .find((url): url is string => !!url && /^https:\/\//.test(url));
    const fileUrl = str(meta.json.fileUrl) || fromList;
    if (fileUrl && /^https:\/\//.test(fileUrl)) {
      const img = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
      if (img.ok) return readLimited(img);
    }
  }
  const direct = await fetch(`${PIXAI}/v1/media/${mediaId}/image`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!direct.ok) throw new Error(apiError(direct.status, null, await direct.text()));
  return readLimited(direct);
}

export const fetchMedia = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isRecord(data)) throw new Error("請求格式不正確");
    const apiKey = cleanKey(data.apiKey);
    const mediaId = cleanId(data.mediaId);
    if (!apiKey || !mediaId) throw new Error("圖片編號不正確");
    return { apiKey, mediaId };
  })
  .handler(async ({ data }): Promise<{ ok: true; base64: string; mime: string } | Fail> => {
    try {
      const image = await downloadMedia(data.apiKey, data.mediaId);
      return { ok: true, base64: image.bytes.toString("base64"), mime: image.mime };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "下載圖片失敗");
    }
  });

export type DriveFile = { id: string; name: string; link?: string };

function driveFiles(data: unknown): DriveFile[] {
  const root = isRecord(data) ? data : null;
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(root?.files)
      ? root.files
      : Array.isArray(root?.items)
        ? root.items
        : [];
  const out: DriveFile[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.file_id) || str(item.id) || str(item.folder_id);
    if (!id) continue;
    out.push({
      id,
      name: str(item.name) || str(item.title) || "未命名",
      link: str(item.web_view_link) || str(item.webViewLink) || str(item.url) || undefined,
    });
  }
  return out;
}

function idFromCreate(data: unknown): string | null {
  const files = driveFiles(data);
  if (files[0]) return files[0].id;
  if (!isRecord(data)) return null;
  return (
    str(data.folder_id) ||
    str(data.file_id) ||
    str(data.id) ||
    (isRecord(data.folder) ? str(data.folder.id) || str(data.folder.file_id) : null) ||
    (isRecord(data.file) ? str(data.file.id) || str(data.file.file_id) : null)
  );
}

type ToolFail = Fail;

async function driveCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | ToolFail> {
  const { callTool } = await import("@/lib/app-data/client.server");
  const { ConnectorType } = await import("@/lib/app-data/types");
  const result = await callTool(toolName, args, { connectorType: ConnectorType.GoogleDrive });
  if (!result.ok) {
    return fail(result.errorMessage || "Google Drive 暫時無法使用", {
      loginRequired: result.loginRequired,
      loginUrl: result.loginUrl,
      pending: result.pending,
    });
  }
  return { ok: true, data: result.data };
}

async function ensureFolder(): Promise<{ ok: true; folderId: string } | ToolFail> {
  const { GoogleDriveTools } = await import("@/lib/app-data/types");
  const found = await driveCall(GoogleDriveTools.search, {
    exact_name: FOLDER_NAME,
    mime_type_filter: "application/vnd.google-apps.folder",
    max_results: 5,
  });
  if (!found.ok) return found;
  const existing = driveFiles(found.data)[0];
  if (existing) return { ok: true, folderId: existing.id };
  const created = await driveCall(GoogleDriveTools.createFolder, { folder_name: FOLDER_NAME });
  if (!created.ok) return created;
  const folderId = idFromCreate(created.data);
  if (!folderId) return fail("資料夾已建立，但沒有取得資料夾編號。");
  return { ok: true, folderId };
}

function safeFileName(label: string, mime: string): string {
  const ext = mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png";
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `huiye-${slug || "work"}-${stamp}.${ext}`;
}

export const saveToDrive = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isRecord(data)) throw new Error("請求格式不正確");
    const base64 = typeof data.base64 === "string" ? data.base64 : "";
    if (base64.length < 32 || base64.length > 10_000_000) throw new Error("圖片資料無法保存");
    const mime = data.mime === "image/webp" || data.mime === "image/jpeg" ? data.mime : "image/png";
    const label = typeof data.label === "string" ? data.label.slice(0, 80) : "work";
    return { base64, mime, label };
  })
  .handler(
    async ({
      data,
    }): Promise<
      | {
          ok: true;
          folderName: string;
          uploaded: boolean;
          projectCopy: boolean;
          link?: string;
          message: string;
        }
      | Fail
    > => {
      const filename = safeFileName(data.label, data.mime);
      let projectCopy = false;
      try {
        const { isWorkspacePreview } = await import("@/lib/env.server");
        if (isWorkspacePreview()) {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const dir = "/workspace/artifacts/huiye";
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, filename), Buffer.from(data.base64, "base64"));
          projectCopy = true;
        }
      } catch {
        projectCopy = false;
      }

      const folder = await ensureFolder();
      if (!folder.ok) {
        if (projectCopy) {
          return {
            ok: true,
            folderName: FOLDER_NAME,
            uploaded: false,
            projectCopy: true,
            message: "圖片已放進這個專案的 Google Drive 檔案。雲端資料夾稍後再試。",
          };
        }
        return folder;
      }

      let uploaded = false;
      let link: string | undefined;
      let uploadError = "";

      if (projectCopy) {
        const artifact = await driveCall("google_drive_upload_artifact", {
          artifact_path: `/huiye/${filename}`,
          file_name: filename,
          folder_id: folder.folderId,
          mime_type: data.mime,
        });
        if (artifact.ok) {
          uploaded = true;
          link = driveFiles(artifact.data)[0]?.link;
        } else if (!artifact.pending && !artifact.loginRequired) {
          uploadError = artifact.error;
        } else {
          return artifact;
        }
      }

      if (!uploaded && data.base64.length < 4_200_000) {
        const direct = await driveCall("google_drive_upload_file", {
          file_name: filename,
          folder_id: folder.folderId,
          mime_type: data.mime,
          content_base64: data.base64,
        });
        if (direct.ok) {
          uploaded = true;
          link = driveFiles(direct.data)[0]?.link;
          uploadError = "";
        } else if (direct.pending || direct.loginRequired) {
          return direct;
        } else {
          uploadError = uploadError || direct.error;
        }
      }

      if (uploaded) {
        return {
          ok: true,
          folderName: FOLDER_NAME,
          uploaded: true,
          projectCopy,
          link,
          message: `已存到 Google Drive「${FOLDER_NAME}」。`,
        };
      }

      if (projectCopy) {
        return {
          ok: true,
          folderName: FOLDER_NAME,
          uploaded: false,
          projectCopy: true,
          message: `圖片已寫入專案裡的 Google Drive 檔案（huiye）。「${FOLDER_NAME}」資料夾已備好，直接上傳這次沒有成功。`,
        };
      }

      return fail(
        uploadError
          ? `已建立「${FOLDER_NAME}」，但圖片沒能上傳：${uploadError}`
          : `已建立「${FOLDER_NAME}」，但這個連接目前不能直接上傳圖片。請先下載，再放進該資料夾。`,
      );
    },
  );

export const listDriveAlbum = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true; folderName: string; files: DriveFile[] } | Fail> => {
    const folder = await ensureFolder();
    if (!folder.ok) return folder;
    const { GoogleDriveTools } = await import("@/lib/app-data/types");
    const listed = await driveCall(GoogleDriveTools.listFolder, {
      folder_id: folder.folderId,
      max_results: 40,
    });
    if (!listed.ok) return listed;
    return { ok: true, folderName: FOLDER_NAME, files: driveFiles(listed.data) };
  },
);
