import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { db } from "@/db";
import { media } from "@/db/schema";
import { eq } from "drizzle-orm";

export const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

export type MediaKind = "image" | "video" | "audio" | "document";

export const MAX_BYTES: Record<MediaKind, number> = {
  image: 8 * 1024 * 1024,
  video: 60 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

const ALLOWED: Record<MediaKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/ogg"],
  audio: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav"],
  document: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
  ],
};

const useBlobStore = process.env.MEDIA_STORAGE_PROVIDER !== "local" && Boolean(process.env.NETLIFY);
const mediaStore = useBlobStore ? getStore({ name: "media" }) : null;

async function writeMediaBlob(id: string, bytes: Uint8Array) {
  if (mediaStore) {
    await mediaStore.set(id, bytes);
    return;
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, id), bytes);
}

async function readMediaBlob(id: string): Promise<Uint8Array | null> {
  if (mediaStore) {
    const value = await mediaStore.get(id, { type: "arrayBuffer" });
    if (!value) return null;
    return new Uint8Array(value);
  }

  try {
    const buffer = await readFile(path.join(UPLOAD_DIR, id));
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function deleteMediaBlob(id: string) {
  if (mediaStore) {
    await mediaStore.delete(id);
    return;
  }

  try {
    await unlink(path.join(UPLOAD_DIR, id));
  } catch {
    // file already gone
  }
}

export function detectKind(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function validateUpload(kind: MediaKind, mime: string, size: number): string | null {
  if (!ALLOWED[kind].includes(mime)) return "unsupported_type";
  if (size <= 0) return "empty_file";
  if (size > MAX_BYTES[kind]) return "file_too_large";
  return null;
}

export function extensionFor(mime: string, fileName: string): string {
  const fromName = path.extname(fileName).replace(".", "").toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;

  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };

  return map[mime] ?? "bin";
}

export async function storeUpload(
  ownerId: number,
  kind: MediaKind,
  mime: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const id = randomBytes(12).toString("hex");
  const safeName = `${id}.${extensionFor(mime, fileName)}`;

  await writeMediaBlob(id, bytes);

  const [row] = await db
    .insert(media)
    .values({
      id,
      ownerId,
      kind,
      mimeType: mime,
      fileName: fileName.slice(0, 200) || safeName,
      sizeBytes: bytes.byteLength,
    })
    .returning();

  return row;
}

export async function readMediaFile(id: string) {
  return readMediaBlob(id);
}

export async function deleteMediaRow(id: string) {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (!row) return;

  await db.delete(media).where(eq(media.id, id));
  await deleteMediaBlob(id);
}
