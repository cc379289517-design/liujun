import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import {
  IroningMachineStatus,
  IroningTaskStage,
  OnlineStatus,
  ProfileStatus,
  Role,
  TaskStatus,
} from "@/generated/prisma/client";
import { ASSISTANT_EATING_SUB_STATUS } from "@/lib/eatingPresence";
import { POST as createTaskRoute } from "@/app/api/tasks/route";
import { PATCH as updateTaskRoute } from "@/app/api/tasks/[id]/route";
import { POST as updateTaskCollaboratorsRoute } from "@/app/api/tasks/[id]/collaborators/route";
import { PATCH as updateProfileRoute } from "@/app/api/profiles/[id]/route";
import {
  assignTask,
  balanceIroningWaitAssignments,
  cancelPrimaryAssistantTransfer,
  escalatePriorities,
  completeTask,
  interruptExecutingPreempt,
  interruptWaitingPreempt,
  prepareWaitingTaskForAssistantStart,
  processPendingTaskAssistantTransfers,
  reassignOverdueStandbyTasks,
  releaseUnselectedStandbyTasks,
  requestPrimaryAssistantTransfer,
  respondPrimaryAssistantTransfer,
  runTaskMaintenance,
  sweepIroningMachineQueue,
  updateTaskParticipantStatus,
} from "@/lib/scheduler";
import {
  PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
} from "@/lib/photographerTaskLimit";

type TestContext = {
  buildingId: number;
  photographerId: string;
  regularCategoryId: number;
  ironingCategoryId: number;
};

type TestCase = {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
};

const ACTIVE_TASK_STATUSES = [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] as const;
const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejects(action: () => Promise<unknown>, message: string): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error(message);
}

function assertInvariantDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("invariant-test")) {
    throw new Error(`拒绝运行：DATABASE_URL 必须指向 invariant-test 隔离库，当前为 ${url || "(empty)"}`);
  }
}

async function resetDomain() {
  await prisma.taskAssistantTransferRequest.deleteMany();
  await prisma.standbyReassignmentNotice.deleteMany();
  await prisma.taskCompletionRegistration.deleteMany();
  await prisma.taskPriorityUpgradeRequest.deleteMany();
  await prisma.taskCollaborator.deleteMany();
  await prisma.bookingTask.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.room.deleteMany();
  await prisma.ironingMachine.deleteMany();
  await prisma.taskCategory.deleteMany();
  await prisma.systemConfig.deleteMany();
  await prisma.building.deleteMany();
}

async function seedBase(): Promise<TestContext> {
  const building = await prisma.building.create({ data: { name: "不变量测试楼" } });
  await prisma.systemConfig.createMany({
    data: [
      { key: "interruption_max", value: "30", label: "插单最大离场时间(分钟)" },
      { key: "upgrade_threshold", value: "30", label: "自动提权阈值(分钟)" },
      { key: "photographer_max_active_tasks", value: "20", label: "摄影师最多同时下达任务数" },
      { key: "ironing_machine_claim_ttl_min", value: "2", label: "熨烫机使用权保护时间(分钟)" },
      { key: "standby_reassign_timeout_min", value: "20", label: "待就位超时多久更换派发助理(分钟)" },
      { key: "collaboration_queue_auto_close_limit", value: "99", label: "协作自动关闭队列阈值" },
    ],
  });
  const regular = await prisma.taskCategory.create({
    data: {
      name: "手持测试",
      description: "业务不变量测试普通任务",
      priorityLevel: 3,
      minDuration: 10,
      maxDuration: 60,
      estDuration: 20,
      canBeInterrupted: true,
    },
  });
  const ironing = await prisma.taskCategory.create({
    data: {
      name: "短时熨烫测试",
      description: "业务不变量测试熨烫任务",
      priorityLevel: 3,
      minDuration: 10,
      maxDuration: 30,
      estDuration: 20,
      canBeInterrupted: true,
    },
  });
  const photographer = await prisma.profile.create({
    data: {
      id: "inv-photographer",
      employeeId: "INV-P",
      name: "不变量摄影师",
      role: Role.photographer,
      buildingId: building.id,
      currentRoom: "101",
    },
  });
  await prisma.room.create({
    data: {
      buildingId: building.id,
      roomNumber: "101",
      floor: 1,
      xPosition: 50,
      yPosition: 50,
    },
  });

  return {
    buildingId: building.id,
    photographerId: photographer.id,
    regularCategoryId: regular.id,
    ironingCategoryId: ironing.id,
  };
}

async function createAssistant(
  ctx: TestContext,
  id: string,
  data: Partial<{
    status: ProfileStatus;
    onlineStatus: OnlineStatus;
    subStatus: string | null;
    activeBuildingId: number | null;
  }> = {},
) {
  return prisma.profile.create({
    data: {
      id,
      employeeId: id.toUpperCase(),
      name: id,
      role: Role.assistant,
      buildingId: ctx.buildingId,
      activeBuildingId: data.activeBuildingId,
      status: data.status ?? ProfileStatus.idle,
      onlineStatus: data.onlineStatus ?? OnlineStatus.online,
      subStatus: data.subStatus ?? null,
    },
  });
}

async function createTask(
  ctx: TestContext,
  data: Partial<{
    assistantId: string | null;
    categoryId: number;
    priority: number;
    status: TaskStatus;
    ironingStage: IroningTaskStage;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    isSpecified: boolean;
    isLocked: boolean;
    lockReason: string | null;
    roomNumber: string;
  }> = {},
) {
  return prisma.bookingTask.create({
    data: {
      photographerId: ctx.photographerId,
      assistantId: data.assistantId ?? null,
      locationBuildingId: ctx.buildingId,
      roomNumber: data.roomNumber ?? "101",
      categoryId: data.categoryId ?? ctx.regularCategoryId,
      priority: data.priority ?? 3,
      isSpecified: data.isSpecified ?? false,
      isLocked: data.isLocked ?? false,
      lockReason: data.lockReason,
      status: data.status ?? TaskStatus.waiting,
      ironingStage: data.ironingStage ?? IroningTaskStage.none,
      createdAt: data.createdAt,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
    },
  });
}

async function createPriorityCategory(priorityLevel: number, name: string, maxDuration = 20) {
  return prisma.taskCategory.create({
    data: {
      name,
      description: `业务不变量测试 P${priorityLevel}`,
      priorityLevel,
      minDuration: Math.min(10, maxDuration),
      maxDuration,
      estDuration: Math.min(20, maxDuration),
      canBeInterrupted: true,
    },
  });
}

async function postTask(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request("http://test.local/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await createTaskRoute(request as never);
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function patchTask(taskId: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://test.local/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await updateTaskRoute(request as never, { params: Promise.resolve({ id: taskId }) });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function updateTaskCollaborators(
  taskId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://test.local/api/tasks/${taskId}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await updateTaskCollaboratorsRoute(request as never, { params: Promise.resolve({ id: taskId }) });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function respondCollaborationInvitation(
  invitationId: string,
  body: { actorAssistantId: string; accepted: boolean },
): Promise<{ status: number; data: Record<string, unknown> }> {
  const { PATCH: respondCollaborationInvitationRoute } = await import(
    "../../src/app/api/collaboration-invitations/[id]/route"
  );
  const request = new Request(`http://test.local/api/collaboration-invitations/${invitationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await respondCollaborationInvitationRoute(request as never, {
    params: Promise.resolve({ id: invitationId }),
  });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function getWorkbenchSync(
  profileId: string,
  buildingId: number,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const { GET: getWorkbenchSyncRoute } = await import("../../src/app/api/workbench/sync/route");
  const params = new URLSearchParams({
    profileId,
    role: "assistant",
    view: "assistant",
    buildingId: String(buildingId),
    full: "1",
  });
  const request = new NextRequest(`http://test.local/api/workbench/sync?${params.toString()}`);
  const response = await getWorkbenchSyncRoute(request);
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function patchProfile(profileId: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://test.local/api/profiles/${profileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await updateProfileRoute(request as never, { params: Promise.resolve({ id: profileId }) });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

async function addParticipant(
  taskId: string,
  assistantId: string,
  role: "primary" | "helper",
  status: "waiting" | "executing" | "paused" | "completed" | "left",
) {
  const startedAt = status === "executing" || status === "paused" || status === "completed" ? new Date(Date.now() - 60_000) : null;
  return prisma.taskCollaborator.create({
    data: {
      taskId,
      assistantId,
      role,
      status,
      startedAt,
      completedAt: status === "completed" ? new Date() : null,
      leftAt: status === "left" || status === "completed" ? new Date() : null,
      workSegmentStartedAt: status === "executing" ? startedAt : null,
    },
  });
}

async function createCollaborationInvitationScenario(ctx: TestContext, idPrefix: string) {
  const primary = await createAssistant(ctx, `${idPrefix}-primary`, { status: ProfileStatus.executing });
  const target = await createAssistant(ctx, `${idPrefix}-target`);
  const task = await createTask(ctx, {
    assistantId: primary.id,
    status: TaskStatus.executing,
    startedAt: new Date(Date.now() - 60_000),
  });
  await addParticipant(task.id, primary.id, "primary", "executing");
  return { primary, target, task };
}

async function assertNoInvariantViolations() {
  const tasks = await prisma.bookingTask.findMany({
    where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
    include: {
      category: { select: { name: true } },
      collaborators: true,
    },
  });

  const activeNonPassiveByAssistant = new Map<string, Set<string>>();
  for (const task of tasks) {
    const isWaitingInterruptChild = task.status === TaskStatus.waiting && task.parentTaskId != null;
    const isPassiveIroningWait =
      task.status === TaskStatus.waiting &&
      task.category.name.includes("熨") &&
      (task.ironingStage === IroningTaskStage.waiting_machine || task.ironingStage === IroningTaskStage.notified);
    const isDeferredSpecifiedWait = task.status === TaskStatus.waiting && task.isSpecified && task.startedAt == null;
    if (!isPassiveIroningWait && !isWaitingInterruptChild && !isDeferredSpecifiedWait && task.assistantId) {
      const taskIds = activeNonPassiveByAssistant.get(task.assistantId) ?? new Set<string>();
      taskIds.add(task.id);
      activeNonPassiveByAssistant.set(task.assistantId, taskIds);
    }
    for (const participant of task.collaborators) {
      if (!ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number])) continue;
      if (isPassiveIroningWait) continue;
      if (isWaitingInterruptChild) continue;
      if (isDeferredSpecifiedWait && participant.startedAt == null) continue;
      const taskIds = activeNonPassiveByAssistant.get(participant.assistantId) ?? new Set<string>();
      taskIds.add(task.id);
      activeNonPassiveByAssistant.set(participant.assistantId, taskIds);
    }
  }
  const multiActive = [...activeNonPassiveByAssistant.entries()]
    .filter(([, taskIds]) => taskIds.size > 1)
    .map(([assistantId, taskIds]) => [assistantId, [...taskIds]]);
  assert(multiActive.length === 0, `同一助理存在多个活跃非被动任务：${JSON.stringify(multiActive)}`);

  const activePrimaryByTask = new Map<string, string[]>();
  const primaryRows = await prisma.taskCollaborator.findMany({
    where: { role: "primary", status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } },
    select: { taskId: true, assistantId: true },
  });
  for (const row of primaryRows) {
    activePrimaryByTask.set(row.taskId, [...(activePrimaryByTask.get(row.taskId) ?? []), row.assistantId]);
  }
  const duplicatePrimary = [...activePrimaryByTask.entries()].filter(([, assistantIds]) => assistantIds.length > 1);
  assert(duplicatePrimary.length === 0, `同一任务存在多个当前主助理：${JSON.stringify(duplicatePrimary)}`);

  const buildings = await prisma.building.findMany({
    select: {
      id: true,
      ironingMachines: { where: { status: IroningMachineStatus.normal }, select: { id: true } },
    },
  });
  for (const building of buildings) {
    const usingTasks = await prisma.bookingTask.findMany({
      where: {
        locationBuildingId: building.id,
        status: { in: [TaskStatus.executing, TaskStatus.paused] },
        ironingStage: IroningTaskStage.using,
      },
      include: { collaborators: true },
    });
    const usingSlots = usingTasks.reduce((total, task) => {
      const activeAssistantIds = new Set<string>();
      if (task.assistantId) activeAssistantIds.add(task.assistantId);
      for (const participant of task.collaborators) {
        if (participant.status !== "left" && participant.status !== "completed") {
          activeAssistantIds.add(participant.assistantId);
        }
      }
      return total + Math.max(1, activeAssistantIds.size);
    }, 0);
    assert(
      usingSlots <= building.ironingMachines.length,
      `熨烫 using 超过机器容量：building=${building.id}, using=${usingSlots}, capacity=${building.ironingMachines.length}`,
    );
  }

  const completedWithActive = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.completed,
      collaborators: { some: { status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } } },
    },
    select: { id: true },
  });
  assert(completedWithActive.length === 0, `已完成任务仍有活跃参与者：${completedWithActive.map((task) => task.id).join(",")}`);
}

const tests: TestCase[] = [
  {
    name: "同一助理不能被派多个活跃非被动任务",
    async run(ctx) {
      const assistant = await createAssistant(ctx, "inv-assistant-active", { status: ProfileStatus.executing });
      await createTask(ctx, {
        assistantId: assistant.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      }).then((task) => addParticipant(task.id, assistant.id, "primary", "executing"));

      const waiting = await createTask(ctx);
      const assigned = await assignTask(waiting.id, ctx.buildingId);
      assert(assigned === null, "已有执行中任务的助理不应再次被派单");
      const fresh = await prisma.bookingTask.findUnique({ where: { id: waiting.id } });
      assert(fresh?.assistantId == null, "未分配任务不应被错误绑定到忙碌助理");
    },
  },
  {
    name: "移交接手后同一任务只保留一个当前主助理",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-transfer-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-transfer-target");
      const task = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, from.id, "primary", "executing");

      await requestPrimaryAssistantTransfer(task.id, from.id, target.id);
      await respondPrimaryAssistantTransfer(task.id, target.id, true);
      await prepareWaitingTaskForAssistantStart(task.id, target.id);

      const activePrimaries = await prisma.taskCollaborator.findMany({
        where: { taskId: task.id, role: "primary", status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } },
      });
      assert(activePrimaries.length === 1 && activePrimaries[0].assistantId === target.id, "移交后必须只有目标助理是当前主助理");
      const fresh = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(fresh?.assistantId === target.id && fresh.status === TaskStatus.waiting, "移交后任务应进入目标助理待就位状态");
    },
  },
  {
    name: "普通移交后旧主助理的完成贡献和个人工时不会在新主助理开始时消失",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-handoff-contribution-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-handoff-contribution-target");
      const segmentStartedAt = new Date();
      const task = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: segmentStartedAt,
      });
      await addParticipant(task.id, from.id, "primary", "executing");
      await prisma.bookingTask.update({
        where: { id: task.id },
        data: { effectiveWorkSeconds: 180, workSegmentStartedAt: segmentStartedAt },
      });
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: task.id, assistantId: from.id } },
        data: {
          effectiveWorkSeconds: 180,
          startedAt: segmentStartedAt,
          workSegmentStartedAt: segmentStartedAt,
        },
      });

      await requestPrimaryAssistantTransfer(task.id, from.id, target.id);
      await respondPrimaryAssistantTransfer(task.id, target.id, true);
      await prepareWaitingTaskForAssistantStart(task.id, target.id);

      const afterHandoff = await prisma.taskCollaborator.findMany({
        where: { taskId: task.id, role: "primary" },
        orderBy: { joinedAt: "asc" },
      });
      const oldPrimaryAfterHandoff = afterHandoff.find((participant) => participant.assistantId === from.id);
      const currentPrimaryAfterHandoff = afterHandoff.filter((participant) =>
        ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]),
      );
      assert(oldPrimaryAfterHandoff?.status === "completed", "移交完成时旧主助理应保留 completed 历史贡献");
      assert(
        oldPrimaryAfterHandoff.effectiveWorkSeconds >= 180 && oldPrimaryAfterHandoff.effectiveWorkSeconds <= 182,
        `移交完成时旧主助理应保留约 180 秒个人工时，实际 ${oldPrimaryAfterHandoff.effectiveWorkSeconds}`,
      );
      assert(
        currentPrimaryAfterHandoff.length === 1 && currentPrimaryAfterHandoff[0].assistantId === target.id,
        "移交后目标助理应是唯一当前 primary",
      );

      await updateTaskParticipantStatus(task.id, target.id, "executing");

      const oldPrimaryAfterTargetStarted = await prisma.taskCollaborator.findUnique({
        where: { taskId_assistantId: { taskId: task.id, assistantId: from.id } },
      });
      assert(
        oldPrimaryAfterTargetStarted?.status === "completed",
        "新主助理开始后，旧主助理有工时的 completed 贡献不能被改成 left",
      );
      assert(
        oldPrimaryAfterTargetStarted.effectiveWorkSeconds >= 180 && oldPrimaryAfterTargetStarted.effectiveWorkSeconds <= 182,
        `新主助理开始后旧主助理个人工时应继续保留，实际 ${oldPrimaryAfterTargetStarted.effectiveWorkSeconds}`,
      );

      const targetSegmentStartedAt = new Date();
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: task.id, assistantId: target.id } },
        data: { effectiveWorkSeconds: 120, workSegmentStartedAt: targetSegmentStartedAt },
      });
      await prisma.bookingTask.update({
        where: { id: task.id },
        data: { effectiveWorkSeconds: oldPrimaryAfterTargetStarted.effectiveWorkSeconds + 120, workSegmentStartedAt: targetSegmentStartedAt },
      });
      await updateTaskParticipantStatus(task.id, target.id, "completed");

      const completedTask = await prisma.bookingTask.findUnique({
        where: { id: task.id },
        include: { collaborators: true },
      });
      const completedFrom = completedTask?.collaborators.find((participant) => participant.assistantId === from.id);
      const completedTarget = completedTask?.collaborators.find((participant) => participant.assistantId === target.id);
      assert(completedTask?.status === TaskStatus.completed, "A/B 都完成贡献后任务聚合应为 completed");
      assert(completedFrom?.status === "completed" && completedTarget?.status === "completed", "A/B 的历史贡献都应保留为 completed");
      assert(
        completedFrom.effectiveWorkSeconds >= 180 && completedFrom.effectiveWorkSeconds <= 182,
        "A 的个人有效工时应保持不变",
      );
      assert(
        completedTarget.effectiveWorkSeconds >= 120 && completedTarget.effectiveWorkSeconds <= 122,
        "B 的个人有效工时应独立保留",
      );
      assert(
        completedTask.effectiveWorkSeconds >= 300 && completedTask.effectiveWorkSeconds <= 304,
        `任务总有效工时应聚合 A/B 的约 300 秒，实际 ${completedTask.effectiveWorkSeconds}`,
      );
    },
  },
  {
    name: "立即交换后双方旧任务的完成贡献在接手人开始和任务完成后仍保留",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-swap-contribution-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-swap-contribution-target", { status: ProfileStatus.executing });
      const segmentStartedAt = new Date();
      const sourceTask = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: segmentStartedAt,
        roomNumber: "101",
      });
      const counterpartTask = await createTask(ctx, {
        assistantId: target.id,
        status: TaskStatus.executing,
        startedAt: segmentStartedAt,
        roomNumber: "102",
      });
      await addParticipant(sourceTask.id, from.id, "primary", "executing");
      await addParticipant(counterpartTask.id, target.id, "primary", "executing");
      await prisma.bookingTask.update({
        where: { id: sourceTask.id },
        data: { effectiveWorkSeconds: 90, workSegmentStartedAt: segmentStartedAt },
      });
      await prisma.bookingTask.update({
        where: { id: counterpartTask.id },
        data: { effectiveWorkSeconds: 120, workSegmentStartedAt: segmentStartedAt },
      });
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: sourceTask.id, assistantId: from.id } },
        data: { effectiveWorkSeconds: 90, startedAt: segmentStartedAt, workSegmentStartedAt: segmentStartedAt },
      });
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: counterpartTask.id, assistantId: target.id } },
        data: { effectiveWorkSeconds: 120, startedAt: segmentStartedAt, workSegmentStartedAt: segmentStartedAt },
      });

      const transfer = await requestPrimaryAssistantTransfer(sourceTask.id, from.id, target.id);
      assert(transfer.kind === "swap" && transfer.counterpartTaskId === counterpartTask.id, "目标助理忙碌时应创建立即交换请求");
      await respondPrimaryAssistantTransfer(sourceTask.id, target.id, true, "pause_and_go");

      await updateTaskParticipantStatus(sourceTask.id, target.id, "executing");
      await updateTaskParticipantStatus(counterpartTask.id, from.id, "executing");

      const participantsAfterStart = await prisma.taskCollaborator.findMany({
        where: { taskId: { in: [sourceTask.id, counterpartTask.id] }, role: "primary" },
      });
      const sourceOldPrimary = participantsAfterStart.find(
        (participant) => participant.taskId === sourceTask.id && participant.assistantId === from.id,
      );
      const counterpartOldPrimary = participantsAfterStart.find(
        (participant) => participant.taskId === counterpartTask.id && participant.assistantId === target.id,
      );
      assert(sourceOldPrimary?.status === "completed", "交换后 A 在原任务的完成贡献不能在 B 开始时变成 left");
      assert(counterpartOldPrimary?.status === "completed", "交换后 B 在原任务的完成贡献不能在 A 开始时变成 left");
      assert(
        sourceOldPrimary.effectiveWorkSeconds >= 90 && sourceOldPrimary.effectiveWorkSeconds <= 92,
        "A 在原任务的个人有效工时应保留",
      );
      assert(
        counterpartOldPrimary.effectiveWorkSeconds >= 120 && counterpartOldPrimary.effectiveWorkSeconds <= 122,
        "B 在原任务的个人有效工时应保留",
      );

      const activePrimaries = participantsAfterStart.filter((participant) =>
        ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]),
      );
      assert(
        activePrimaries.length === 2 &&
          activePrimaries.some((participant) => participant.taskId === sourceTask.id && participant.assistantId === target.id) &&
          activePrimaries.some((participant) => participant.taskId === counterpartTask.id && participant.assistantId === from.id),
        "立即交换后两条任务应各自只有一个接手 primary",
      );

      const sourceNextSegment = new Date(Date.now() - 40_000);
      const counterpartNextSegment = new Date(Date.now() - 50_000);
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: sourceTask.id, assistantId: target.id } },
        data: { workSegmentStartedAt: sourceNextSegment },
      });
      await prisma.bookingTask.update({
        where: { id: sourceTask.id },
        data: { workSegmentStartedAt: sourceNextSegment },
      });
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: counterpartTask.id, assistantId: from.id } },
        data: { workSegmentStartedAt: counterpartNextSegment },
      });
      await prisma.bookingTask.update({
        where: { id: counterpartTask.id },
        data: { workSegmentStartedAt: counterpartNextSegment },
      });
      await updateTaskParticipantStatus(sourceTask.id, target.id, "completed");
      await updateTaskParticipantStatus(counterpartTask.id, from.id, "completed");

      const completedTasks = await prisma.bookingTask.findMany({
        where: { id: { in: [sourceTask.id, counterpartTask.id] } },
        include: { collaborators: true },
      });
      assert(completedTasks.every((task) => task.status === TaskStatus.completed), "立即交换后的两条任务都应正确聚合为 completed");
      assert(
        completedTasks.every((task) => task.collaborators.every((participant) => participant.status === "completed")),
        "立即交换后的四条人员-任务贡献都应保留为 completed",
      );
      const completedSource = completedTasks.find((task) => task.id === sourceTask.id);
      const completedCounterpart = completedTasks.find((task) => task.id === counterpartTask.id);
      assert(
        completedSource != null && completedSource.effectiveWorkSeconds >= 130 && completedSource.effectiveWorkSeconds <= 133,
        "源任务总有效工时应保留交换前后两人的贡献",
      );
      assert(
        completedCounterpart != null && completedCounterpart.effectiveWorkSeconds >= 170 && completedCounterpart.effectiveWorkSeconds <= 173,
        "对方任务总有效工时应保留交换前后两人的贡献",
      );
    },
  },
  {
    name: "熨烫任务可以像普通任务一样移交给空闲助理",
    async run(ctx) {
      await prisma.ironingMachine.create({
        data: { buildingId: ctx.buildingId, name: "移交熨烫机", status: IroningMachineStatus.normal },
      });
      const from = await createAssistant(ctx, "inv-ironing-handoff-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-ironing-handoff-target");
      const task = await createTask(ctx, {
        assistantId: from.id,
        categoryId: ctx.ironingCategoryId,
        status: TaskStatus.executing,
        ironingStage: IroningTaskStage.using,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, from.id, "primary", "executing");

      await requestPrimaryAssistantTransfer(task.id, from.id, target.id);
      await respondPrimaryAssistantTransfer(task.id, target.id, true);
      await prepareWaitingTaskForAssistantStart(task.id, target.id);

      const activePrimaries = await prisma.taskCollaborator.findMany({
        where: { taskId: task.id, role: "primary", status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } },
      });
      assert(activePrimaries.length === 1 && activePrimaries[0].assistantId === target.id, "熨烫移交后必须只有目标助理是当前主助理");
      const oldPrimary = await prisma.taskCollaborator.findUnique({
        where: { taskId_assistantId: { taskId: task.id, assistantId: from.id } },
      });
      assert(oldPrimary?.status === "completed", "熨烫移交后原主助理贡献应结算为 completed");
      const fresh = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(
        fresh?.assistantId === target.id &&
          fresh.status === TaskStatus.waiting &&
          fresh.ironingStage === IroningTaskStage.notified,
        "熨烫移交后任务应进入目标助理准备熨烫状态",
      );

      await updateTaskParticipantStatus(task.id, target.id, "executing");
      const started = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(started?.status === TaskStatus.executing && started.ironingStage === IroningTaskStage.using, "目标助理应可继续开始熨烫任务");
    },
  },
  {
    name: "熨烫任务可以和其他执行中任务马上互换",
    async run(ctx) {
      await prisma.ironingMachine.create({
        data: { buildingId: ctx.buildingId, name: "互换熨烫机", status: IroningMachineStatus.normal },
      });
      const from = await createAssistant(ctx, "inv-ironing-swap-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-ironing-swap-target", { status: ProfileStatus.executing });
      const ironingTask = await createTask(ctx, {
        assistantId: from.id,
        categoryId: ctx.ironingCategoryId,
        status: TaskStatus.executing,
        ironingStage: IroningTaskStage.using,
        startedAt: new Date(Date.now() - 120_000),
      });
      const regularTask = await createTask(ctx, {
        assistantId: target.id,
        categoryId: ctx.regularCategoryId,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(ironingTask.id, from.id, "primary", "executing");
      await addParticipant(regularTask.id, target.id, "primary", "executing");

      const transfer = await requestPrimaryAssistantTransfer(ironingTask.id, from.id, target.id);
      assert(transfer.kind === "swap" && transfer.counterpartTaskId === regularTask.id, "熨烫任务应能创建互换请求");
      await respondPrimaryAssistantTransfer(ironingTask.id, target.id, true, "pause_and_go");

      const freshIroning = await prisma.bookingTask.findUnique({ where: { id: ironingTask.id } });
      const freshRegular = await prisma.bookingTask.findUnique({ where: { id: regularTask.id } });
      assert(
        freshIroning?.assistantId === target.id &&
          freshIroning.status === TaskStatus.waiting &&
          freshIroning.ironingStage === IroningTaskStage.notified,
        "熨烫任务互换后应切给目标助理并进入准备熨烫",
      );
      assert(
        freshRegular?.assistantId === from.id &&
          freshRegular.status === TaskStatus.waiting &&
          freshRegular.ironingStage === IroningTaskStage.none,
        "对方普通任务互换后应切给原熨烫助理并进入待就位",
      );
      const activePrimaries = await prisma.taskCollaborator.findMany({
        where: {
          taskId: { in: [ironingTask.id, regularTask.id] },
          role: "primary",
          status: { in: [...ACTIVE_PARTICIPANT_STATUSES] },
        },
      });
      assert(activePrimaries.length === 2, "互换后两条任务各自只能保留一个当前主助理");
      const usingCount = await prisma.bookingTask.count({
        where: { categoryId: ctx.ironingCategoryId, status: TaskStatus.executing, ironingStage: IroningTaskStage.using },
      });
      assert(usingCount === 0, "熨烫互换后未重新开始前不应继续占用 using 机器");
    },
  },
  {
    name: "熨烫 using 数不能超过正常机器容量",
    async run(ctx) {
      await prisma.ironingMachine.create({
        data: { buildingId: ctx.buildingId, name: "测试熨烫机1", status: IroningMachineStatus.normal },
      });
      const firstAssistant = await createAssistant(ctx, "inv-iron-1", { status: ProfileStatus.assigned });
      const secondAssistant = await createAssistant(ctx, "inv-iron-2", { status: ProfileStatus.assigned });
      const firstTask = await createTask(ctx, {
        assistantId: firstAssistant.id,
        categoryId: ctx.ironingCategoryId,
        ironingStage: IroningTaskStage.notified,
      });
      const secondTask = await createTask(ctx, {
        assistantId: secondAssistant.id,
        categoryId: ctx.ironingCategoryId,
        ironingStage: IroningTaskStage.waiting_machine,
      });
      await addParticipant(firstTask.id, firstAssistant.id, "primary", "waiting");
      await addParticipant(secondTask.id, secondAssistant.id, "primary", "waiting");

      await updateTaskParticipantStatus(firstTask.id, firstAssistant.id, "executing");
      await expectRejects(
        () => updateTaskParticipantStatus(secondTask.id, secondAssistant.id, "executing"),
        "第二个熨烫任务不应在单台机器容量下开始",
      );
      const secondFresh = await prisma.bookingTask.findUnique({ where: { id: secondTask.id } });
      assert(secondFresh?.ironingStage !== IroningTaskStage.using, "容量不足时第二个熨烫任务不能进入 using");
    },
  },
  {
    name: "已完成任务不能保留活跃参与者",
    async run(ctx) {
      const primary = await createAssistant(ctx, "inv-complete-primary", { status: ProfileStatus.executing });
      const helper = await createAssistant(ctx, "inv-complete-helper", { status: ProfileStatus.executing });
      const task = await createTask(ctx, {
        assistantId: primary.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, primary.id, "primary", "executing");
      await addParticipant(task.id, helper.id, "helper", "executing");

      await completeTask(task.id);
      const activeParticipants = await prisma.taskCollaborator.count({
        where: { taskId: task.id, status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } },
      });
      assert(activeParticipants === 0, "completeTask 后不能留下活跃参与者");
    },
  },
  {
    name: "离线或吃饭助理不能被派普通新任务",
    async run(ctx) {
      await createAssistant(ctx, "inv-offline", { onlineStatus: OnlineStatus.offline });
      await createAssistant(ctx, "inv-eating", { subStatus: ASSISTANT_EATING_SUB_STATUS });
      const task = await createTask(ctx);

      const assigned = await assignTask(task.id, ctx.buildingId);
      assert(assigned === null, "离线或吃饭助理不应被普通派单选中");
      const fresh = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(fresh?.assistantId == null, "任务应保持未分配");
    },
  },
  {
    name: "协作任务未全员完成不能整体完成，全员完成后必须完成",
    async run(ctx) {
      const primary = await createAssistant(ctx, "inv-collab-primary", { status: ProfileStatus.assigned });
      const helper = await createAssistant(ctx, "inv-collab-helper", { status: ProfileStatus.assigned });
      const task = await createTask(ctx, { assistantId: primary.id });
      await addParticipant(task.id, primary.id, "primary", "waiting");
      await addParticipant(task.id, helper.id, "helper", "waiting");

      await updateTaskParticipantStatus(task.id, primary.id, "completed");
      const halfDone = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(halfDone?.status !== TaskStatus.completed, "协作任务只有部分成员完成时不能整体 completed");

      await updateTaskParticipantStatus(task.id, helper.id, "completed");
      const allDone = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(allDone?.status === TaskStatus.completed, "协作任务全员完成后必须整体 completed");
    },
  },
  {
    name: "新增协作只创建待确认邀请且目标助理保持空闲",
    async run(ctx) {
      const { primary, target, task } = await createCollaborationInvitationScenario(ctx, "inv-collab-pending");

      const response = await updateTaskCollaborators(task.id, {
        actorProfileId: primary.id,
        actorAssistantId: primary.id,
        assistantIds: [target.id],
      });
      assert(response.status === 200, `主助理发起协作邀请应成功，实际 ${response.status}`);

      const [helperCount, freshTarget] = await Promise.all([
        prisma.taskCollaborator.count({
          where: { taskId: task.id, assistantId: target.id, role: "helper", status: "waiting" },
        }),
        prisma.profile.findUnique({ where: { id: target.id } }),
      ]);
      assert(helperCount === 0, "目标确认前不能提前生成 helper waiting");
      assert(freshTarget?.status === ProfileStatus.idle, "目标确认前必须保持 idle");
      const invitation = await prisma.taskCollaborationInvitation.findFirst({
        where: { taskId: task.id, targetAssistantId: target.id, status: "pending" },
      });
      assert(invitation != null, "新增协作必须生成一条 pending 邀请");
      const sync = await getWorkbenchSync(target.id, ctx.buildingId);
      const syncedInvitations = Array.isArray(sync.data.collaborationInvitations)
        ? sync.data.collaborationInvitations as Array<{ id?: string }>
        : [];
      assert(sync.status === 200, `目标助理工作台同步应成功，实际 ${sync.status}`);
      assert(syncedInvitations.some((item) => item.id === invitation.id), "目标助理工作台必须收到 pending 协作邀请");
    },
  },
  {
    name: "目标接受协作邀请后才生成唯一待就位参与者且不能重复响应",
    async run(ctx) {
      const { primary, target, task } = await createCollaborationInvitationScenario(ctx, "inv-collab-accept");
      const created = await updateTaskCollaborators(task.id, {
        actorProfileId: primary.id,
        actorAssistantId: primary.id,
        assistantIds: [target.id],
      });
      assert(created.status === 200, `创建协作邀请应成功，实际 ${created.status}`);
      const invitation = await prisma.taskCollaborationInvitation.findFirst({
        where: { taskId: task.id, targetAssistantId: target.id, status: "pending" },
      });
      assert(invitation != null, "接受前必须存在 pending 邀请");

      const accepted = await respondCollaborationInvitation(invitation.id, {
        actorAssistantId: target.id,
        accepted: true,
      });
      assert(accepted.status === 200, `目标助理接受邀请应成功，实际 ${accepted.status}`);

      const [acceptedInvitation, helperCount, freshTarget] = await Promise.all([
        prisma.taskCollaborationInvitation.findUnique({ where: { id: invitation.id } }),
        prisma.taskCollaborator.count({
          where: { taskId: task.id, assistantId: target.id, role: "helper", status: "waiting" },
        }),
        prisma.profile.findUnique({ where: { id: target.id } }),
      ]);
      assert(acceptedInvitation?.status === "accepted", "接受后邀请必须标记 accepted");
      assert(helperCount === 1, "接受后必须且只能生成一个 helper waiting");
      assert(freshTarget?.status === ProfileStatus.assigned, "接受后目标助理才变为 assigned");
      const syncAfterAccept = await getWorkbenchSync(target.id, ctx.buildingId);
      const pendingAfterAccept = Array.isArray(syncAfterAccept.data.collaborationInvitations)
        ? syncAfterAccept.data.collaborationInvitations as Array<{ id?: string }>
        : [];
      assert(!pendingAfterAccept.some((item) => item.id === invitation.id), "接受后邀请必须从目标助理待处理消息中移除");

      const duplicate = await respondCollaborationInvitation(invitation.id, {
        actorAssistantId: target.id,
        accepted: true,
      });
      assert(duplicate.status === 409, `重复响应已处理邀请必须返回 409，实际 ${duplicate.status}`);
      const helperCountAfterDuplicate = await prisma.taskCollaborator.count({
        where: { taskId: task.id, assistantId: target.id, role: "helper", status: "waiting" },
      });
      assert(helperCountAfterDuplicate === 1, "重复接受不能重复创建 helper waiting");
    },
  },
  {
    name: "摄影师发起的协作邀请被拒绝后目标助理仍保持空闲",
    async run(ctx) {
      const { target, task } = await createCollaborationInvitationScenario(ctx, "inv-collab-reject");
      const created = await updateTaskCollaborators(task.id, {
        actorProfileId: ctx.photographerId,
        assistantIds: [target.id],
      });
      assert(created.status === 200, `摄影师创建协作邀请应成功，实际 ${created.status}`);
      const invitation = await prisma.taskCollaborationInvitation.findFirst({
        where: { taskId: task.id, targetAssistantId: target.id, status: "pending" },
      });
      assert(invitation != null, "摄影师新增协作也必须生成 pending 邀请");

      const rejected = await respondCollaborationInvitation(invitation.id, {
        actorAssistantId: target.id,
        accepted: false,
      });
      assert(rejected.status === 200, `目标助理拒绝邀请应成功，实际 ${rejected.status}`);
      const [freshInvitation, helperCount, freshTarget] = await Promise.all([
        prisma.taskCollaborationInvitation.findUnique({ where: { id: invitation.id } }),
        prisma.taskCollaborator.count({ where: { taskId: task.id, assistantId: target.id, role: "helper" } }),
        prisma.profile.findUnique({ where: { id: target.id } }),
      ]);
      assert(freshInvitation?.status === "rejected", "拒绝后邀请必须标记 rejected");
      assert(helperCount === 0, "拒绝邀请不能生成协作参与者");
      assert(freshTarget?.status === ProfileStatus.idle, "拒绝邀请后目标助理必须保持 idle");
    },
  },
  {
    name: "非目标响应和目标资格漂移都不能错误接受协作邀请",
    async run(ctx) {
      const { primary, target, task } = await createCollaborationInvitationScenario(ctx, "inv-collab-drift");
      const intruder = await createAssistant(ctx, "inv-collab-intruder");
      const created = await updateTaskCollaborators(task.id, {
        actorProfileId: primary.id,
        actorAssistantId: primary.id,
        assistantIds: [target.id],
      });
      assert(created.status === 200, `创建协作邀请应成功，实际 ${created.status}`);
      const invitation = await prisma.taskCollaborationInvitation.findFirst({
        where: { taskId: task.id, targetAssistantId: target.id, status: "pending" },
      });
      assert(invitation != null, "资格校验前必须存在 pending 邀请");

      const unauthorized = await respondCollaborationInvitation(invitation.id, {
        actorAssistantId: intruder.id,
        accepted: true,
      });
      assert(unauthorized.status === 403, `非邀请目标响应必须返回 403，实际 ${unauthorized.status}`);
      const pendingAfterUnauthorized = await prisma.taskCollaborationInvitation.findUnique({ where: { id: invitation.id } });
      assert(pendingAfterUnauthorized?.status === "pending", "越权响应不能改变邀请状态");

      const driftTask = await createTask(ctx, { assistantId: target.id, status: TaskStatus.waiting });
      await addParticipant(driftTask.id, target.id, "primary", "waiting");
      await prisma.profile.update({ where: { id: target.id }, data: { status: ProfileStatus.assigned } });

      const drifted = await respondCollaborationInvitation(invitation.id, {
        actorAssistantId: target.id,
        accepted: true,
      });
      assert(drifted.status === 409, `目标助理变忙后接受必须返回 409，实际 ${drifted.status}`);
      const [expiredInvitation, helperCount, freshTarget] = await Promise.all([
        prisma.taskCollaborationInvitation.findUnique({ where: { id: invitation.id } }),
        prisma.taskCollaborator.count({ where: { taskId: task.id, assistantId: target.id, role: "helper" } }),
        prisma.profile.findUnique({ where: { id: target.id } }),
      ]);
      assert(expiredInvitation?.status === "expired", "目标资格漂移后邀请必须标记 expired");
      assert(helperCount === 0, "目标资格漂移后不能生成协作参与者");
      assert(freshTarget?.status === ProfileStatus.assigned, "资格漂移失败不能覆盖目标助理的新任务状态");
    },
  },
  {
    name: "任务完成时待确认协作邀请必须自动失效",
    async run(ctx) {
      const { primary, target, task } = await createCollaborationInvitationScenario(ctx, "inv-collab-task-completed");
      const created = await updateTaskCollaborators(task.id, {
        actorProfileId: primary.id,
        actorAssistantId: primary.id,
        assistantIds: [target.id],
      });
      assert(created.status === 200, `创建协作邀请应成功，实际 ${created.status}`);
      const invitation = await prisma.taskCollaborationInvitation.findFirst({
        where: { taskId: task.id, targetAssistantId: target.id, status: "pending" },
      });
      assert(invitation != null, "任务完成前必须存在 pending 邀请");

      await completeTask(task.id);

      const expired = await prisma.taskCollaborationInvitation.findUnique({ where: { id: invitation.id } });
      assert(expired?.status === "expired", "任务完成后 pending 协作邀请必须标记 expired");
      assert(expired?.reason === "task_completed", "任务完成导致的邀请失效必须记录稳定原因");
    },
  },
  {
    name: "转派请求在任务完成或负责人变化后必须失效",
    async run(ctx) {
      const fromDone = await createAssistant(ctx, "inv-expire-from-done", { status: ProfileStatus.executing });
      const targetDone = await createAssistant(ctx, "inv-expire-target-done");
      const doneTask = await createTask(ctx, {
        assistantId: fromDone.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(doneTask.id, fromDone.id, "primary", "executing");
      const doneTransfer = await requestPrimaryAssistantTransfer(doneTask.id, fromDone.id, targetDone.id);
      assert(doneTransfer.requestId, "应创建待确认移交请求");
      await completeTask(doneTask.id);
      await expectRejects(
        () => respondPrimaryAssistantTransfer(doneTask.id, targetDone.id, true),
        "任务完成后转派响应必须失败",
      );
      const expiredDone = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: doneTransfer.requestId } });
      assert(expiredDone?.status === "expired", "任务完成后的转派请求必须标记 expired");

      const fromChanged = await createAssistant(ctx, "inv-expire-from-change", { status: ProfileStatus.executing });
      const targetChanged = await createAssistant(ctx, "inv-expire-target-change");
      const replacement = await createAssistant(ctx, "inv-expire-replacement", { status: ProfileStatus.assigned });
      const changedTask = await createTask(ctx, {
        assistantId: fromChanged.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(changedTask.id, fromChanged.id, "primary", "executing");
      const changedTransfer = await requestPrimaryAssistantTransfer(changedTask.id, fromChanged.id, targetChanged.id);
      assert(changedTransfer.requestId, "应创建待确认移交请求");
      await prisma.bookingTask.update({
        where: { id: changedTask.id },
        data: { assistantId: replacement.id },
      });
      await expectRejects(
        () => respondPrimaryAssistantTransfer(changedTask.id, targetChanged.id, true),
        "负责人变化后转派响应必须失败",
      );
      const expiredChanged = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: changedTransfer.requestId } });
      assert(expiredChanged?.status === "expired", "负责人变化后的转派请求必须标记 expired");

      const processed = await processPendingTaskAssistantTransfers();
      assert(processed === 0, "失效转派不应被后台维护继续处理");
    },
  },
  {
    name: "原助理只能取消尚未确认的交换请求",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-cancel-swap-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-cancel-swap-target", { status: ProfileStatus.executing });
      const sourceTask = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(),
        roomNumber: "441",
      });
      const counterpartTask = await createTask(ctx, {
        assistantId: target.id,
        status: TaskStatus.executing,
        startedAt: new Date(),
        roomNumber: "442",
      });
      await addParticipant(sourceTask.id, from.id, "primary", "executing");
      await addParticipant(counterpartTask.id, target.id, "primary", "executing");

      const transfer = await requestPrimaryAssistantTransfer(sourceTask.id, from.id, target.id);
      assert(transfer.kind === "swap" && transfer.requestId, "忙碌助理之间应创建待确认交换请求");
      await expectRejects(
        () => cancelPrimaryAssistantTransfer(sourceTask.id, target.id),
        "目标助理不能取消原助理发起的交换",
      );

      const cancelResponse = await patchTask(sourceTask.id, {
        action: "cancelPrimaryAssistantTransfer",
        actorAssistantId: from.id,
      });
      assert(cancelResponse.status === 200, "原助理通过任务接口应能取消待确认交换");
      const canceledRequest = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: transfer.requestId } });
      const tasksAfterCancel = await prisma.bookingTask.findMany({
        where: { id: { in: [sourceTask.id, counterpartTask.id] } },
        select: { id: true, assistantId: true, status: true },
      });
      assert(canceledRequest?.status === "canceled" && canceledRequest.canceledAt, "取消后请求应记录 canceled 与取消时间");
      assert(
        tasksAfterCancel.find((task) => task.id === sourceTask.id)?.assistantId === from.id &&
          tasksAfterCancel.find((task) => task.id === counterpartTask.id)?.assistantId === target.id,
        "取消待确认交换不能改变双方任务负责人",
      );
      await expectRejects(
        () => cancelPrimaryAssistantTransfer(sourceTask.id, from.id),
        "同一交换请求不能重复取消",
      );
      await expectRejects(
        () => respondPrimaryAssistantTransfer(sourceTask.id, target.id, true, "pause_and_go"),
        "交换取消后目标助理不能再确认",
      );
    },
  },
  {
    name: "并发重复发起只能创建一条活跃移交请求",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-transfer-concurrent-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-transfer-concurrent-target");
      const task = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, from.id, "primary", "executing");

      const attempts = await Promise.allSettled([
        requestPrimaryAssistantTransfer(task.id, from.id, target.id),
        requestPrimaryAssistantTransfer(task.id, from.id, target.id),
      ]);
      const activeRequests = await prisma.taskAssistantTransferRequest.findMany({
        where: {
          taskId: task.id,
          status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] },
        },
      });
      assert(attempts.filter((attempt) => attempt.status === "fulfilled").length === 1, "并发发起只能有一次成功");
      assert(activeRequests.length === 1, "同一任务最多只能有一条活跃移交请求");
    },
  },
  {
    name: "并发重复响应只能确认一次且不会二次执行移交",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-transfer-response-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-transfer-response-target");
      const task = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, from.id, "primary", "executing");

      const transfer = await requestPrimaryAssistantTransfer(task.id, from.id, target.id);
      assert(transfer.requestId, "应创建待确认移交请求");
      const responses = await Promise.allSettled([
        respondPrimaryAssistantTransfer(task.id, target.id, true),
        respondPrimaryAssistantTransfer(task.id, target.id, true),
      ]);
      assert(responses.filter((response) => response.status === "fulfilled").length === 1, "并发响应只能有一次成功");
      const ready = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: transfer.requestId } });
      assert(ready?.status === "ready_to_takeover", "重复响应后请求应只进入一次 ready_to_takeover");

      await prepareWaitingTaskForAssistantStart(task.id, target.id);
      await prepareWaitingTaskForAssistantStart(task.id, target.id);
      const participants = await prisma.taskCollaborator.findMany({ where: { taskId: task.id, role: "primary" } });
      const activePrimaries = participants.filter((participant) =>
        ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]),
      );
      assert(activePrimaries.length === 1 && activePrimaries[0].assistantId === target.id, "重复执行后仍应只有一个当前 primary");
      assert(
        participants.find((participant) => participant.assistantId === from.id)?.status === "completed",
        "原主助理贡献只能结算一次并保持 completed",
      );
    },
  },
  {
    name: "移交目标确认后状态漂移必须失效且不能切换负责人",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-handoff-drift-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-handoff-drift-target");
      const task = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(task.id, from.id, "primary", "executing");

      const transfer = await requestPrimaryAssistantTransfer(task.id, from.id, target.id);
      assert(transfer.requestId, "应创建移交请求");
      await respondPrimaryAssistantTransfer(task.id, target.id, true);
      await prisma.profile.update({
        where: { id: target.id },
        data: { onlineStatus: OnlineStatus.offline },
      });

      await expectRejects(
        () => prepareWaitingTaskForAssistantStart(task.id, target.id),
        "目标助理状态漂移后不能继续接手",
      );

      const expired = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: transfer.requestId } });
      assert(expired?.status === "expired", "目标助理状态漂移后 ready 移交请求必须标记 expired");
      const freshTask = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(freshTask?.assistantId === from.id, "目标漂移失败后任务负责人不能被切走");
    },
  },
  {
    name: "互换写入前对方任务负责人漂移必须失效且不覆盖变化",
    async run(ctx) {
      const from = await createAssistant(ctx, "inv-swap-drift-from", { status: ProfileStatus.executing });
      const target = await createAssistant(ctx, "inv-swap-drift-target", { status: ProfileStatus.executing });
      const replacement = await createAssistant(ctx, "inv-swap-drift-replacement", { status: ProfileStatus.executing });
      const sourceTask = await createTask(ctx, {
        assistantId: from.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 120_000),
      });
      const counterpartTask = await createTask(ctx, {
        assistantId: target.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(sourceTask.id, from.id, "primary", "executing");
      await addParticipant(counterpartTask.id, target.id, "primary", "executing");

      const transfer = await requestPrimaryAssistantTransfer(sourceTask.id, from.id, target.id);
      assert(transfer.requestId && transfer.kind === "swap" && transfer.counterpartTaskId === counterpartTask.id, "应创建互换请求");
      const driftedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.taskCollaborator.update({
          where: { taskId_assistantId: { taskId: counterpartTask.id, assistantId: target.id } },
          data: {
            status: "completed",
            completedAt: driftedAt,
            leftAt: driftedAt,
            workSegmentStartedAt: null,
          },
        });
        await tx.bookingTask.update({
          where: { id: counterpartTask.id },
          data: { assistantId: replacement.id },
        });
        await tx.taskCollaborator.create({
          data: {
            taskId: counterpartTask.id,
            assistantId: replacement.id,
            role: "primary",
            status: "executing",
            startedAt: driftedAt,
            workSegmentStartedAt: driftedAt,
          },
        });
      });

      await expectRejects(
        () => respondPrimaryAssistantTransfer(sourceTask.id, target.id, true, "pause_and_go"),
        "对方任务负责人变化后不能继续互换",
      );

      const expired = await prisma.taskAssistantTransferRequest.findUnique({ where: { id: transfer.requestId } });
      assert(expired?.status === "expired", "对方任务负责人漂移后互换请求必须标记 expired");
      const freshSource = await prisma.bookingTask.findUnique({ where: { id: sourceTask.id } });
      const freshCounterpart = await prisma.bookingTask.findUnique({ where: { id: counterpartTask.id } });
      assert(freshSource?.assistantId === from.id, "互换失败后源任务负责人不能被覆盖");
      assert(freshCounterpart?.assistantId === replacement.id, "互换失败后对方任务负责人变化不能被覆盖");
    },
  },
  {
    name: "P1执行中插单完成后父任务恢复待就位",
    async run(ctx) {
      const p1 = await createPriorityCategory(1, "P1插单测试", 10);
      const assistant = await createAssistant(ctx, "inv-exec-interrupt", { status: ProfileStatus.executing });
      const parent = await createTask(ctx, {
        assistantId: assistant.id,
        priority: 3,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 5 * 60_000),
      });
      await addParticipant(parent.id, assistant.id, "primary", "executing");
      const child = await createTask(ctx, { categoryId: p1.id, priority: 1 });

      const interrupted = await interruptExecutingPreempt(ctx.buildingId, child.id, 1, 10);
      assert(interrupted, "P1 新任务应能插入低优先级执行中任务");
      const inserted = await prisma.bookingTask.findUnique({ where: { id: child.id } });
      assert(inserted?.assistantId === assistant.id, "P1 插单应绑定当前执行助理");
      assert(inserted?.parentTaskId === parent.id, "P1 插单应记录父任务");

      await completeTask(child.id);
      const restoredParent = await prisma.bookingTask.findUnique({ where: { id: parent.id } });
      assert(restoredParent?.status === TaskStatus.waiting, "插单完成后父任务应恢复待就位");
      const freshAssistant = await prisma.profile.findUnique({ where: { id: assistant.id } });
      assert(freshAssistant?.status === ProfileStatus.assigned, "插单完成后助理应回到待就位状态");
    },
  },
  {
    name: "P1待就位让行保持父子关系且不误完成原任务",
    async run(ctx) {
      const p1 = await createPriorityCategory(1, "P1待就位让行测试", 10);
      const assistant = await createAssistant(ctx, "inv-waiting-preempt", { status: ProfileStatus.assigned });
      const parent = await createTask(ctx, {
        assistantId: assistant.id,
        priority: 3,
        status: TaskStatus.waiting,
      });
      await addParticipant(parent.id, assistant.id, "primary", "waiting");
      const child = await createTask(ctx, { categoryId: p1.id, priority: 1 });

      const preempted = await interruptWaitingPreempt(ctx.buildingId, child.id, 1, 10);
      assert(preempted, "P1 新任务应能抢占低优先级待就位任务");
      const inserted = await prisma.bookingTask.findUnique({ where: { id: child.id } });
      assert(inserted?.assistantId === assistant.id, "让行子任务应绑定原待就位助理");
      assert(inserted?.parentTaskId === parent.id, "让行子任务应记录父任务");
      const parentStillWaiting = await prisma.bookingTask.findUnique({ where: { id: parent.id } });
      assert(parentStillWaiting?.status === TaskStatus.waiting, "原待就位任务不能被误完成");
    },
  },
  {
    name: "待就位超时换人会换派并生成通知",
    async run(ctx) {
      const oldAssistant = await createAssistant(ctx, "inv-standby-old", { status: ProfileStatus.assigned });
      const newAssistant = await createAssistant(ctx, "inv-standby-new");
      const task = await createTask(ctx, {
        assistantId: oldAssistant.id,
        priority: 3,
        status: TaskStatus.waiting,
      });
      await addParticipant(task.id, oldAssistant.id, "primary", "waiting");
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } },
        data: { joinedAt: new Date(Date.now() - 30 * 60_000) },
      });

      const reassigned = await reassignOverdueStandbyTasks();
      assert(reassigned === 1, "待就位超时任务应被换派");
      const freshTask = await prisma.bookingTask.findUnique({ where: { id: task.id } });
      assert(freshTask?.assistantId === newAssistant.id, "超时任务应换派给新的空闲助理");
      const oldParticipant = await prisma.taskCollaborator.findUnique({
        where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } },
      });
      assert(oldParticipant?.status === "left", "原助理参与记录应退出");
      const newParticipant = await prisma.taskCollaborator.findUnique({
        where: { taskId_assistantId: { taskId: task.id, assistantId: newAssistant.id } },
      });
      assert(newParticipant?.status === "waiting", "新助理应成为待就位 primary");
      const notice = await prisma.standbyReassignmentNotice.findFirst({ where: { taskId: task.id } });
      assert(notice?.oldAssistantId === oldAssistant.id && notice.newAssistantId === newAssistant.id, "换派应生成通知记录");
      const freshOldAssistant = await prisma.profile.findUnique({ where: { id: oldAssistant.id } });
      assert(
        freshOldAssistant?.status === ProfileStatus.idle &&
          freshOldAssistant.onlineStatus === OnlineStatus.online &&
          freshOldAssistant.isOnline,
        "系统换派只能恢复原助理为空闲，不能改变其在线状态",
      );
      assert(notice?.oldAssistantSetOffline === false, "系统换派通知不能记录原助理被自动下线");
    },
  },
  {
    name: "普通待就位超时无替代助理时释放公共队列但保持在线",
    async run(ctx) {
      const oldAssistant = await createAssistant(ctx, "inv-standby-no-replacement-online", { status: ProfileStatus.assigned });
      const task = await createTask(ctx, {
        assistantId: oldAssistant.id,
        priority: 3,
        status: TaskStatus.waiting,
      });
      await addParticipant(task.id, oldAssistant.id, "primary", "waiting");
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } },
        data: { joinedAt: new Date(Date.now() - 30 * 60_000) },
      });

      const reassigned = await reassignOverdueStandbyTasks();
      const [freshTask, freshAssistant, participant, notice] = await Promise.all([
        prisma.bookingTask.findUnique({ where: { id: task.id } }),
        prisma.profile.findUnique({ where: { id: oldAssistant.id } }),
        prisma.taskCollaborator.findUnique({ where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } } }),
        prisma.standbyReassignmentNotice.findFirst({ where: { taskId: task.id } }),
      ]);
      assert(reassigned === 1, "无替代助理时普通超时任务应释放到公共队列");
      assert(freshTask?.assistantId === null, "普通超时任务应释放为未分配公共队列");
      assert(freshAssistant?.status === ProfileStatus.idle, "释放公共队列后原助理应恢复空闲状态");
      assert(freshAssistant?.onlineStatus === OnlineStatus.online && freshAssistant.isOnline, "系统不能因为超时扫描强制在线助理下线");
      assert(participant?.status === "left", "释放公共队列时原 primary 应退出");
      assert(notice?.reason === "standby_timeout_no_replacement" && notice.oldAssistantSetOffline === false, "通知不能再记录为自动下线");
    },
  },
  {
    name: "准备熨烫超时无替代助理时保留归属并保持在线",
    async run(ctx) {
      const oldAssistant = await createAssistant(ctx, "inv-ironing-notified-no-replacement", {
        status: ProfileStatus.assigned,
      });
      const task = await createTask(ctx, {
        assistantId: oldAssistant.id,
        categoryId: ctx.ironingCategoryId,
        priority: 3,
        status: TaskStatus.waiting,
        ironingStage: IroningTaskStage.notified,
      });
      const overdueAt = new Date(Date.now() - 30 * 60_000);
      await addParticipant(task.id, oldAssistant.id, "primary", "waiting");
      await Promise.all([
        prisma.bookingTask.update({
          where: { id: task.id },
          data: { ironingNotifiedAt: overdueAt },
        }),
        prisma.taskCollaborator.update({
          where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } },
          data: { joinedAt: overdueAt },
        }),
      ]);

      const reassigned = await reassignOverdueStandbyTasks();
      const [freshTask, freshAssistant, participant, notice] = await Promise.all([
        prisma.bookingTask.findUnique({ where: { id: task.id } }),
        prisma.profile.findUnique({ where: { id: oldAssistant.id } }),
        prisma.taskCollaborator.findUnique({ where: { taskId_assistantId: { taskId: task.id, assistantId: oldAssistant.id } } }),
        prisma.standbyReassignmentNotice.findFirst({ where: { taskId: task.id } }),
      ]);

      assert(reassigned === 1, "准备熨烫超时无人替换时应生成一次处理记录");
      assert(freshTask?.assistantId === oldAssistant.id, "准备熨烫任务应保留原助理归属");
      assert(freshTask?.ironingStage === IroningTaskStage.notified, "准备熨烫状态不应被待就位换派扫描篡改");
      assert(participant?.status === "waiting", "保留归属时原 primary 参与记录应继续等待");
      assert(
        freshAssistant?.status === ProfileStatus.idle &&
          freshAssistant.onlineStatus === OnlineStatus.online &&
          freshAssistant.isOnline,
        "准备熨烫无人替换时只能恢复空闲，不能改变在线状态",
      );
      assert(
        notice?.reason === "standby_timeout_ironing_retained" && notice.oldAssistantSetOffline === false,
        "准备熨烫保留归属必须使用独立通知原因，不能误报释放公共队列",
      );
    },
  },
  {
    name: "指定助理成功时直接绑定并创建primary参与记录",
    async run(ctx) {
      const assistant = await createAssistant(ctx, "inv-specified-ok");
      const response = await postTask({
        photographerId: ctx.photographerId,
        locationBuildingId: ctx.buildingId,
        roomNumber: "101",
        categoryId: ctx.regularCategoryId,
        isSpecified: true,
        assistantId: assistant.id,
      });
      assert(response.status === 201, `指定助理创建应成功，实际 ${response.status}`);
      assert(typeof response.data.id === "string", "创建响应应返回任务 id");
      const task = await prisma.bookingTask.findUnique({ where: { id: response.data.id as string } });
      assert(task?.assistantId === assistant.id && task.isSpecified, "指定任务应绑定指定助理并标记 isSpecified");
      const participant = await prisma.taskCollaborator.findUnique({
        where: { taskId_assistantId: { taskId: task.id, assistantId: assistant.id } },
      });
      assert(participant?.role === "primary" && participant.status === "waiting", "指定任务应创建 primary waiting 参与记录");
    },
  },
  {
    name: "指定普通任务不会因原助理正在工作而自动释放给其他人",
    async run(ctx) {
      const specified = await createAssistant(ctx, "inv-specified-release-owner", { status: ProfileStatus.executing });
      await createAssistant(ctx, "inv-specified-release-idle");
      const active = await createTask(ctx, {
        assistantId: specified.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(active.id, specified.id, "primary", "executing");
      const waiting = await createTask(ctx, {
        assistantId: specified.id,
        isSpecified: true,
        status: TaskStatus.waiting,
      });
      await addParticipant(waiting.id, specified.id, "primary", "waiting");

      const moved = await releaseUnselectedStandbyTasks();
      const fresh = await prisma.bookingTask.findUnique({ where: { id: waiting.id } });
      assert(moved === 0, "指定任务不能进入未选择待就位释放");
      assert(fresh?.assistantId === specified.id && fresh.isSpecified, "指定任务必须保留原指定助理");
    },
  },
  {
    name: "指定任务待就位超时也不会自动换人或把指定助理置离线",
    async run(ctx) {
      const specified = await createAssistant(ctx, "inv-specified-timeout-owner", { status: ProfileStatus.assigned });
      await createAssistant(ctx, "inv-specified-timeout-idle");
      const waiting = await createTask(ctx, {
        assistantId: specified.id,
        isSpecified: true,
        status: TaskStatus.waiting,
      });
      await addParticipant(waiting.id, specified.id, "primary", "waiting");
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: waiting.id, assistantId: specified.id } },
        data: { joinedAt: new Date(Date.now() - 30 * 60_000) },
      });

      const moved = await reassignOverdueStandbyTasks();
      const [freshTask, freshAssistant, notices] = await Promise.all([
        prisma.bookingTask.findUnique({ where: { id: waiting.id } }),
        prisma.profile.findUnique({ where: { id: specified.id } }),
        prisma.standbyReassignmentNotice.count({ where: { taskId: waiting.id } }),
      ]);
      assert(moved === 0, "指定任务不能进入待就位超时换派");
      assert(freshTask?.assistantId === specified.id, "超时后仍必须保留原指定助理");
      assert(freshAssistant?.onlineStatus === OnlineStatus.online, "指定助理不能因指定任务等待超时被系统置离线");
      assert(notices === 0, "指定任务不应生成自动换派通知");
    },
  },
  {
    name: "指定熨烫等待不参与负载均衡换人",
    async run(ctx) {
      const specified = await createAssistant(ctx, "inv-specified-ironing-owner", { status: ProfileStatus.assigned });
      await createAssistant(ctx, "inv-specified-ironing-idle");
      for (const priority of [3, 4]) {
        const task = await createTask(ctx, {
          assistantId: specified.id,
          categoryId: ctx.ironingCategoryId,
          priority,
          isSpecified: true,
          status: TaskStatus.waiting,
          ironingStage: IroningTaskStage.waiting_machine,
        });
        await addParticipant(task.id, specified.id, "primary", "waiting");
      }

      const moved = await balanceIroningWaitAssignments();
      const tasks = await prisma.bookingTask.findMany({ where: { isSpecified: true } });
      assert(moved === 0, "指定熨烫任务不能参与等待负载均衡");
      assert(tasks.length === 2 && tasks.every((task) => task.assistantId === specified.id), "全部指定熨烫任务都必须保留原助理");
    },
  },
  {
    name: "指定熨烫任务等待机器时不会改派空闲助理",
    async run(ctx) {
      await prisma.ironingMachine.create({
        data: { buildingId: ctx.buildingId, name: "指定任务测试熨烫机", status: IroningMachineStatus.normal },
      });
      const specified = await createAssistant(ctx, "inv-specified-machine-owner", { status: ProfileStatus.executing });
      await createAssistant(ctx, "inv-specified-machine-idle");
      const active = await createTask(ctx, {
        assistantId: specified.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(active.id, specified.id, "primary", "executing");
      const ironing = await createTask(ctx, {
        assistantId: specified.id,
        categoryId: ctx.ironingCategoryId,
        isSpecified: true,
        status: TaskStatus.waiting,
        ironingStage: IroningTaskStage.waiting_machine,
      });
      await addParticipant(ironing.id, specified.id, "primary", "waiting");

      await sweepIroningMachineQueue();
      const fresh = await prisma.bookingTask.findUnique({ where: { id: ironing.id } });
      assert(fresh?.assistantId === specified.id, "指定助理忙碌时熨烫任务必须原地等待，不能改派空闲助理");
      assert(fresh?.ironingStage === IroningTaskStage.waiting_machine, "指定助理忙碌时不能提前占用熨烫机使用权");
    },
  },
  {
    name: "摄影师取消指定后任务才重新进入普通空余助理派发",
    async run(ctx) {
      const specified = await createAssistant(ctx, "inv-cancel-specified-owner", { status: ProfileStatus.executing });
      const idle = await createAssistant(ctx, "inv-cancel-specified-idle");
      const active = await createTask(ctx, {
        assistantId: specified.id,
        status: TaskStatus.executing,
        startedAt: new Date(Date.now() - 60_000),
      });
      await addParticipant(active.id, specified.id, "primary", "executing");
      const waiting = await createTask(ctx, {
        assistantId: specified.id,
        isSpecified: true,
        status: TaskStatus.waiting,
      });
      await addParticipant(waiting.id, specified.id, "primary", "waiting");

      const response = await patchTask(waiting.id, {
        action: "cancelSpecifiedAssistant",
        actorProfileId: ctx.photographerId,
      });
      assert(response.status === 200, `摄影师取消指定应成功，实际 ${response.status}`);
      const fresh = await prisma.bookingTask.findUnique({ where: { id: waiting.id } });
      assert(fresh?.isSpecified === false, "取消指定后必须清除 isSpecified");
      assert(fresh?.assistantId === idle.id, "取消指定接口返回前应按普通规则派给空余助理");
    },
  },
  {
    name: "新熨烫任务优先派给当前熨烫等待数量更少的助理",
    async run(ctx) {
      const zeroWait = await createAssistant(ctx, "inv-ironing-zero-wait");
      const oneWait = await createAssistant(ctx, "inv-ironing-one-wait", { status: ProfileStatus.assigned });
      const existing = await createTask(ctx, {
        assistantId: oneWait.id,
        categoryId: ctx.ironingCategoryId,
        status: TaskStatus.waiting,
        ironingStage: IroningTaskStage.waiting_machine,
      });
      await addParticipant(existing.id, oneWait.id, "primary", "waiting");
      await prisma.systemConfig.create({
        data: {
          key: `idle_dispatch_rr_b${ctx.buildingId}`,
          value: zeroWait.id,
          label: "测试轮询指针",
        },
      });
      const incoming = await createTask(ctx, {
        categoryId: ctx.ironingCategoryId,
        status: TaskStatus.waiting,
      });

      const assigned = await assignTask(incoming.id, ctx.buildingId);
      assert(assigned === zeroWait.id, "熨烫等待为 0 的助理必须优先于轮询下一位但已有等待的助理");

      const tiedIncoming = await createTask(ctx, {
        categoryId: ctx.ironingCategoryId,
        status: TaskStatus.waiting,
      });
      const tiedAssigned = await assignTask(tiedIncoming.id, ctx.buildingId);
      assert(tiedAssigned === oneWait.id, "熨烫等待数量相同时必须继续使用楼座轮询下一位");
    },
  },
  {
    name: "助理切换服务楼座时指定待就位任务不会被释放",
    async run(ctx) {
      const specified = await createAssistant(ctx, "inv-specified-building-change", { status: ProfileStatus.assigned });
      const waiting = await createTask(ctx, {
        assistantId: specified.id,
        isSpecified: true,
        status: TaskStatus.waiting,
      });
      await addParticipant(waiting.id, specified.id, "primary", "waiting");

      const response = await patchProfile(specified.id, { activeBuildingId: ctx.buildingId + 1 });
      assert(response.status === 200, `指定助理切换服务楼座应成功，实际 ${response.status}`);
      const [freshTask, freshParticipant] = await Promise.all([
        prisma.bookingTask.findUnique({ where: { id: waiting.id } }),
        prisma.taskCollaborator.findUnique({ where: { taskId_assistantId: { taskId: waiting.id, assistantId: specified.id } } }),
      ]);
      assert(freshTask?.assistantId === specified.id && freshTask.isSpecified, "指定任务不能因服务楼座切换而释放负责人");
      assert(freshParticipant?.role === "primary" && freshParticipant.status === "waiting", "指定任务应保留 primary waiting");
    },
  },
  {
    name: "指定助理拒绝离线吃饭跨楼座且不产生脏任务",
    async run(ctx) {
      const otherBuilding = await prisma.building.create({ data: { name: "指定助理跨楼测试楼" } });
      const offline = await createAssistant(ctx, "inv-specified-offline", { onlineStatus: OnlineStatus.offline });
      const eating = await createAssistant(ctx, "inv-specified-eating", { subStatus: ASSISTANT_EATING_SUB_STATUS });
      const crossBuilding = await prisma.profile.create({
        data: {
          id: "inv-specified-cross",
          employeeId: "INV-SPECIFIED-CROSS",
          name: "inv-specified-cross",
          role: Role.assistant,
          buildingId: otherBuilding.id,
          status: ProfileStatus.idle,
          onlineStatus: OnlineStatus.online,
        },
      });

      for (const assistant of [offline, eating, crossBuilding]) {
        const before = await prisma.bookingTask.count();
        const response = await postTask({
          photographerId: ctx.photographerId,
          locationBuildingId: ctx.buildingId,
          roomNumber: "101",
          categoryId: ctx.regularCategoryId,
          isSpecified: true,
          assistantId: assistant.id,
        });
        assert(response.status >= 400, `不可用指定助理 ${assistant.id} 应被拒绝`);
        const after = await prisma.bookingTask.count();
        assert(after === before, `指定助理 ${assistant.id} 失败后不能产生脏任务`);
      }
    },
  },
  {
    name: "摄影师任务上限会进入个人队列并在完成后释放",
    async run(ctx) {
      await prisma.systemConfig.update({
        where: { key: "photographer_max_active_tasks" },
        data: { value: "1" },
      });
      const active = await createTask(ctx, { status: TaskStatus.waiting });

      const queuedResponse = await postTask({
        photographerId: ctx.photographerId,
        locationBuildingId: ctx.buildingId,
        roomNumber: "101",
        categoryId: ctx.regularCategoryId,
      });
      assert(queuedResponse.status === 201, "超过摄影师上限的第一条新任务应进入个人队列");
      const queued = await prisma.bookingTask.findUnique({ where: { id: queuedResponse.data.id as string } });
      assert(
        queued?.isLocked === true && queued.lockReason === PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
        "超过上限任务应被个人队列锁定",
      );

      const rejectedResponse = await postTask({
        photographerId: ctx.photographerId,
        locationBuildingId: ctx.buildingId,
        roomNumber: "101",
        categoryId: ctx.regularCategoryId,
      });
      assert(rejectedResponse.status === 409, "个人队列已满时继续发布应被拦截");

      await completeTask(active.id);
      await runTaskMaintenance({ force: true });
      const released = await prisma.bookingTask.findUnique({ where: { id: queued!.id } });
      assert(released?.isLocked === false && released.lockReason == null, "活跃任务完成后个人队列任务应释放");
    },
  },
  {
    name: "自动提权覆盖未分配和已分配待就位等待任务",
    async run(ctx) {
      const old = new Date(Date.now() - 40 * 60_000);
      const unassigned = await createTask(ctx, {
        priority: 3,
        status: TaskStatus.waiting,
        createdAt: old,
      });
      const assistant = await createAssistant(ctx, "inv-escalate-assigned", { status: ProfileStatus.assigned });
      const assigned = await createTask(ctx, {
        assistantId: assistant.id,
        priority: 4,
        status: TaskStatus.waiting,
        createdAt: new Date(),
      });
      await addParticipant(assigned.id, assistant.id, "primary", "waiting");
      await prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId: assigned.id, assistantId: assistant.id } },
        data: { joinedAt: old },
      });

      const escalated = await escalatePriorities();
      assert(escalated === 2, "未分配和已分配待就位等待任务都应参与自动提权");
      const freshUnassigned = await prisma.bookingTask.findUnique({ where: { id: unassigned.id } });
      const freshAssigned = await prisma.bookingTask.findUnique({ where: { id: assigned.id } });
      assert(freshUnassigned?.priority === 2 && freshUnassigned.escalatedFromPriority === 3, "未分配 waiting 应从 P3 提到 P2");
      assert(freshAssigned?.priority === 3 && freshAssigned.escalatedFromPriority === 4, "已分配待就位应按 primary 等待时间从 P4 提到 P3");
    },
  },
];

async function main() {
  assertInvariantDatabaseUrl();

  const results: string[] = [];
  for (const test of tests) {
    await resetDomain();
    const ctx = await seedBase();
    await test.run(ctx);
    await assertNoInvariantViolations();
    results.push(`PASS ${test.name}`);
  }

  console.log("# Business Invariant Tests");
  console.log("");
  for (const result of results) console.log(`- ${result}`);
  console.log("");
  console.log(`Result: PASS (${results.length}/${tests.length})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
