import assert from "node:assert/strict";
import test from "node:test";

import {
  apiTaskToDisplay,
  isIncomingTransferForProfile,
  outgoingConfirmingSwapForProfile,
  passiveIroningWaitingPresentation,
  removeStaleActiveTasksForIdleProfile,
  transferResponseButtonsDisabled,
  taskStatusLabelForList,
} from "../../src/app/photographer/taskDisplay";
import type { TaskFromAPI } from "../../src/app/photographer/types";

function task(overrides: Partial<TaskFromAPI>): TaskFromAPI {
  return {
    id: "task-ironing",
    photographerId: "photographer-a",
    assistantId: "assistant-a",
    locationBuildingId: 1,
    roomNumber: "429",
    categoryId: 1,
    priority: 3,
    status: "waiting",
    isSpecified: false,
    ironingStage: "waiting_machine",
    ironingQueuedAt: null,
    ironingNotifiedAt: null,
    ironingStartedAt: null,
    note: null,
    createdAt: "2026-07-18T09:05:05.516Z",
    startedAt: null,
    completedAt: null,
    pausedAt: null,
    estEndTime: null,
    isLocked: false,
    lockReason: null,
    parentTaskId: null,
    photographer: { id: "photographer-a", name: "王品端", currentRoom: "429", buildingId: 1 },
    assistant: { id: "assistant-a", name: "邱诗婷", currentRoom: "429" },
    collaborators: [],
    category: {
      id: 1,
      name: "熨烫",
      priorityLevel: 3,
      estDuration: 30,
      minDuration: 30,
      maxDuration: 60,
    },
    ...overrides,
  };
}

test("空闲助理清理旧执行和暂停任务但保留等待和历史任务", () => {
  const executing = task({
    id: "task-stale-executing",
    status: "executing",
    startedAt: "2026-07-18T09:00:00.000Z",
    collaborators: [{
      id: "participant-stale",
      taskId: "task-stale-executing",
      assistantId: "assistant-a",
      role: "primary",
      status: "executing",
      joinedAt: "2026-07-18T08:59:00.000Z",
      startedAt: "2026-07-18T09:00:00.000Z",
      completedAt: null,
      leftAt: null,
      effectiveWorkSeconds: 0,
      workSegmentStartedAt: "2026-07-18T09:00:00.000Z",
      assistant: { id: "assistant-a", name: "张晓琦", currentRoom: "418", avatar: null, buildingId: 1 },
    }],
  });
  const paused = task({
    ...executing,
    id: "task-stale-paused",
    status: "paused",
    pausedAt: "2026-07-18T09:05:00.000Z",
    collaborators: (executing.collaborators ?? []).map((participant) => ({
      ...participant,
      id: "participant-stale-paused",
      taskId: "task-stale-paused",
      status: "paused",
    })),
  });
  const waiting = task({ id: "task-waiting", status: "waiting", startedAt: null, completedAt: null });
  const completed = task({ id: "task-history", status: "completed", completedAt: "2026-07-18T09:10:00.000Z" });

  const result = removeStaleActiveTasksForIdleProfile(
    [executing, paused, waiting, completed],
    "assistant-a",
    "idle",
  );

  assert.deepEqual(result.map((item) => item.id), ["task-waiting", "task-history"]);
});

test("等待熨烫任务在机器有空但助理正忙时展示忙后熨烫", () => {
  const ironingTask = task({});

  const presentation = passiveIroningWaitingPresentation(ironingTask, {
    freeIroningMachineCount: 1,
    hasWorkingTaskForProfile: true,
  });

  assert.equal(presentation.label, "忙后熨烫");
  assert.equal(presentation.description, "熨烫机有空，完成当前任务后再熨烫");
});

test("等待熨烫任务在没有空闲机器时仍展示等待熨烫机", () => {
  const ironingTask = task({});

  const presentation = passiveIroningWaitingPresentation(ironingTask, {
    freeIroningMachineCount: 0,
    hasWorkingTaskForProfile: true,
  });

  assert.equal(presentation.label, "等待熨烫机");
});

test("助理任务列表会按本人忙碌状态把等待熨烫机改为忙后熨烫", () => {
  const ironingTask = task({});
  const executingTask = task({
    id: "task-executing",
    category: { id: 2, name: "手持", priorityLevel: 1, estDuration: 5, minDuration: 1, maxDuration: 5 },
    status: "executing",
    ironingStage: "none",
    startedAt: "2026-07-18T09:31:26.044Z",
  });
  const display = apiTaskToDisplay(ironingTask, "assistant-a");

  assert.equal(
    taskStatusLabelForList(display, ironingTask, [ironingTask, executingTask], {
      freeIroningMachineCount: 1,
      profileId: "assistant-a",
    }),
    "忙后熨烫",
  );
}
);

test("目标助理收到待确认交换时，不把原助理的执行中任务显示成第二条进行中", () => {
  const incomingSwapTask = task({
    id: "task-incoming-swap",
    assistantId: "assistant-other",
    assistant: { id: "assistant-other", name: "原助理", currentRoom: "428" },
    roomNumber: "428",
    status: "executing",
    ironingStage: "none",
    startedAt: "2026-07-18T09:20:00.000Z",
    assistantTransferRequests: [{
      id: "transfer-confirming",
      taskId: "task-incoming-swap",
      fromAssistantId: "assistant-other",
      targetAssistantId: "assistant-a",
      counterpartTaskId: "task-executing",
      kind: "swap",
      responseMode: null,
      status: "confirming",
      reason: "assistant_swap_confirming",
      requestedAt: "2026-07-18T09:30:00.000Z",
      targetConfirmedAt: null,
      completedAt: null,
      canceledAt: null,
    }],
  });
  const display = apiTaskToDisplay(incomingSwapTask, "assistant-a");

  assert.equal(display.statusLabel, "待确认交换");
  assert.equal(display.progress, null);
  assert.equal(
    taskStatusLabelForList(display, incomingSwapTask, [incomingSwapTask], {
      profileId: "assistant-a",
    }),
    "待确认交换",
  );
});

test("交换请求附着到目标助理当前 counterpart 时，当前任务仍保持进行中", () => {
  const currentCounterpartTask = task({
    id: "task-executing",
    status: "executing",
    ironingStage: "none",
    startedAt: "2026-07-18T09:20:00.000Z",
    assistantTransferRequests: [{
      id: "transfer-confirming",
      taskId: "task-incoming-swap",
      fromAssistantId: "assistant-other",
      targetAssistantId: "assistant-a",
      counterpartTaskId: "task-executing",
      kind: "swap",
      responseMode: null,
      status: "confirming",
      reason: "assistant_swap_confirming",
      requestedAt: "2026-07-18T09:30:00.000Z",
      targetConfirmedAt: null,
      completedAt: null,
      canceledAt: null,
    }],
  });
  const display = apiTaskToDisplay(currentCounterpartTask, "assistant-a");

  assert.equal(display.statusLabel, "进行中");
  assert.notEqual(display.progress, null);
});

test("已完成任务上的陈旧确认请求不再显示待确认交换", () => {
  const completedIncomingTask = task({
    id: "task-completed-incoming",
    assistantId: "assistant-other",
    assistant: { id: "assistant-other", name: "原助理", currentRoom: "428" },
    status: "completed",
    ironingStage: "none",
    startedAt: "2026-07-18T09:20:00.000Z",
    completedAt: "2026-07-18T09:40:00.000Z",
    assistantTransferRequests: [{
      id: "transfer-stale-confirming",
      taskId: "task-completed-incoming",
      fromAssistantId: "assistant-other",
      targetAssistantId: "assistant-a",
      counterpartTaskId: "task-executing",
      kind: "swap",
      responseMode: null,
      status: "confirming",
      reason: "assistant_swap_confirming",
      requestedAt: "2026-07-18T09:30:00.000Z",
      targetConfirmedAt: null,
      completedAt: null,
      canceledAt: null,
    }],
  });
  const display = apiTaskToDisplay(completedIncomingTask, "assistant-a");

  assert.equal(display.statusLabel, "已完成");
});

test("结束后接替任务在原任务完成前不显示成进行中", () => {
  const afterCompleteTask = task({
    id: "task-after-complete",
    assistantId: "assistant-other",
    assistant: { id: "assistant-other", name: "原助理", currentRoom: "428" },
    status: "executing",
    ironingStage: "none",
    startedAt: "2026-07-18T09:20:00.000Z",
    assistantTransferRequests: [{
      id: "transfer-after-complete",
      taskId: "task-after-complete",
      fromAssistantId: "assistant-other",
      targetAssistantId: "assistant-a",
      counterpartTaskId: "task-executing",
      kind: "swap",
      responseMode: "after_complete",
      status: "pending_after_complete",
      reason: "target_assistant_confirmed_after_complete",
      requestedAt: "2026-07-18T09:30:00.000Z",
      targetConfirmedAt: "2026-07-18T09:31:00.000Z",
      completedAt: null,
      canceledAt: null,
    }],
  });
  const display = apiTaskToDisplay(afterCompleteTask, "assistant-a");

  assert.equal(display.statusLabel, "结束后接替");
  assert.equal(display.progress, null);
});

test("交换请求目标可以从待确认入口重新打开", () => {
  assert.equal(isIncomingTransferForProfile({ targetAssistantId: "assistant-a" }, "assistant-a"), true);
  assert.equal(isIncomingTransferForProfile({ targetAssistantId: "assistant-b" }, "assistant-a"), false);
});

test("交换响应按钮只在真实响应保存中禁用", () => {
  assert.equal(transferResponseButtonsDisabled(null), false);
  assert.equal(transferResponseButtonsDisabled("pause_and_go"), true);
});

test("只有未完成任务允许原助理取消待确认交换", () => {
  const confirmingSwap = {
    id: "transfer-a",
    taskId: "task-ironing",
    fromAssistantId: "assistant-a",
    targetAssistantId: "assistant-b",
    counterpartTaskId: "task-b",
    kind: "swap",
    status: "confirming",
    responseMode: null,
    reason: null,
    requestedAt: "2026-07-21T09:00:00.000Z",
    targetConfirmedAt: null,
    completedAt: null,
    canceledAt: null,
  };
  const activeTask = task({ status: "executing", assistantTransferRequests: [confirmingSwap] });
  const completedTask = task({
    status: "completed",
    completedAt: "2026-07-21T09:30:00.000Z",
    assistantTransferRequests: [confirmingSwap],
  });

  assert.equal(outgoingConfirmingSwapForProfile(activeTask, "assistant-a")?.id, "transfer-a");
  assert.equal(outgoingConfirmingSwapForProfile(completedTask, "assistant-a"), null);
});
