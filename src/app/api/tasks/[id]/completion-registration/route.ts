import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SKU_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 100;
const REASON_TYPES = new Set(["超时过长", "耗时异常", "其他反馈"]);
const UPLOAD_DIR = path.join(process.cwd(), "public/uploads/task-completions");
const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function safeJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function registrationResponse(registration: {
  id: string;
  taskId: string;
  assistantId: string;
  sku: string;
  imageUrls: string;
  reasonType: string | null;
  description: string | null;
  overtimeMinutesSnapshot: number | null;
  workSecondsSnapshot: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...registration,
    imageUrls: safeJsonStringArray(registration.imageUrls),
  };
}

function trimLimited(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function taskParticipantIds(task: Awaited<ReturnType<typeof findTaskForRegistration>>) {
  if (!task) return new Set<string>();
  return new Set([
    task.assistantId,
    ...task.collaborators.map((participant) => participant.assistantId),
  ].filter((id): id is string => Boolean(id)));
}

function completionOvertimeMinutes(task: NonNullable<Awaited<ReturnType<typeof findTaskForRegistration>>>) {
  const values: number[] = [];
  if (task.completedAt && task.estEndTime) {
    values.push(Math.ceil((task.completedAt.getTime() - task.estEndTime.getTime()) / 60000));
  }
  const capMinutes = task.category.maxDuration > 0 ? task.category.maxDuration : task.category.estDuration;
  if (capMinutes > 0) {
    values.push(Math.ceil((task.effectiveWorkSeconds - capMinutes * 60) / 60));
  }
  const overtime = Math.max(0, ...values);
  return overtime > 0 ? overtime : null;
}

async function findTaskForRegistration(taskId: string) {
  return prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: {
      category: { select: { estDuration: true, maxDuration: true } },
      collaborators: {
        where: { status: { not: "left" } },
        select: { assistantId: true, status: true },
      },
      completionRegistration: true,
    },
  });
}

async function saveUploadedImages(files: File[]) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const urls: string[] = [];
  for (const file of files) {
    if (!file.size) continue;
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("IMAGE_TOO_LARGE");
    }
    const ext = IMAGE_EXT_BY_TYPE[file.type] ?? path.extname(file.name).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].includes(ext)) {
      throw new Error("UNSUPPORTED_IMAGE_TYPE");
    }
    const filename = `task-completion-${Date.now()}-${randomUUID()}${ext === ".jpeg" ? ".jpg" : ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOAD_DIR, filename), buffer);
    urls.push(`/uploads/task-completions/${filename}`);
  }
  return urls;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const registration = await prisma.taskCompletionRegistration.findUnique({
      where: { taskId: id },
    });
    return Response.json(registration ? registrationResponse(registration) : null);
  } catch (error) {
    console.error("[GET /api/tasks/[id]/completion-registration]", error);
    return Response.json({ error: "Failed to fetch completion registration" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const formData = await request.formData();
    const actorAssistantId = trimLimited(formData.get("assistantId"), 80);
    const sku = trimLimited(formData.get("sku"), MAX_SKU_LENGTH);
    const reasonType = trimLimited(formData.get("reasonType"), 20);
    const description = trimLimited(formData.get("description"), MAX_DESCRIPTION_LENGTH);
    const existingImageUrls = formData
      .getAll("existingImageUrls")
      .filter((value): value is string => typeof value === "string");
    const imageFiles = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (!actorAssistantId) {
      return Response.json({ error: "assistantId is required" }, { status: 400 });
    }
    if (!sku) {
      return Response.json({ error: "SKU 必填" }, { status: 400 });
    }
    if (!REASON_TYPES.has(reasonType)) {
      return Response.json({ error: "请选择异常原因" }, { status: 400 });
    }

    const task = await findTaskForRegistration(id);
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.status !== TaskStatus.completed) {
      return Response.json({ error: "只有已完成任务可以登记" }, { status: 409 });
    }
    if (!taskParticipantIds(task).has(actorAssistantId)) {
      return Response.json({ error: "只有该任务助理可以登记" }, { status: 403 });
    }
    let uploadedImageUrls: string[];
    try {
      uploadedImageUrls = await saveUploadedImages(imageFiles);
    } catch (error) {
      if (error instanceof Error && error.message === "UNSUPPORTED_IMAGE_TYPE") {
        return Response.json({ error: "仅支持常见图片格式" }, { status: 400 });
      }
      if (error instanceof Error && error.message === "IMAGE_TOO_LARGE") {
        return Response.json({ error: "单张图片不能超过 8MB" }, { status: 400 });
      }
      throw error;
    }

    const imageUrls = [...existingImageUrls, ...uploadedImageUrls];
    const registration = await prisma.taskCompletionRegistration.upsert({
      where: { taskId: id },
      create: {
        taskId: id,
        assistantId: actorAssistantId,
        sku,
        imageUrls: JSON.stringify(imageUrls),
        reasonType,
        description: description || null,
        overtimeMinutesSnapshot: completionOvertimeMinutes(task),
        workSecondsSnapshot: task.effectiveWorkSeconds,
      },
      update: {
        assistantId: actorAssistantId,
        sku,
        imageUrls: JSON.stringify(imageUrls),
        reasonType,
        description: description || null,
        overtimeMinutesSnapshot: completionOvertimeMinutes(task),
        workSecondsSnapshot: task.effectiveWorkSeconds,
      },
    });

    return Response.json(registrationResponse(registration));
  } catch (error) {
    console.error("[POST /api/tasks/[id]/completion-registration]", error);
    return Response.json({ error: "Failed to save completion registration" }, { status: 500 });
  }
}
