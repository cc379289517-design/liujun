import assert from "node:assert/strict";
import test from "node:test";

import type { DockAssistant } from "../../src/app/photographer/AssistantDock";
import {
  mergeIdentityProfilePatches,
  optimisticAssistantDockForBuilding,
  patchAssistantDockRoom,
  reconcileAssistantDockSnapshot,
  shouldRefreshIdentityProfiles,
  type AssistantProfileForDock,
} from "../../src/app/photographer/assistantDockSync";

function assistant(id: string, currentRoom: string | null): DockAssistant {
  return {
    id,
    name: id,
    status: "idle",
    onlineStatus: "online",
    currentRoom,
    avatar: null,
    group: null,
    currentTask: null,
    pausedRoom: null,
    pausedTaskDesc: null,
    pausedTaskDetail: null,
    pausedElapsedMin: 0,
    preemptedWaitingRoom: null,
    preemptedWaitingTaskDesc: null,
    preemptedWaitingTaskDetail: null,
    newTaskDesc: null,
    resumingFromPause: false,
    pendingRoom: null,
    currentTaskNote: null,
    currentTaskId: null,
    executingOvertimeMin: null,
    pausedOvertimeMin: null,
    preemptedOvertimeMin: null,
  };
}

function profile(id: string, buildingId: number, currentRoom: string | null): AssistantProfileForDock {
  return {
    id,
    name: id,
    status: "idle",
    onlineStatus: "online",
    currentRoom,
    activeRoom: currentRoom,
    avatar: null,
    group: null,
    buildingId,
    activeBuildingId: buildingId,
    role: "assistant",
  };
}

test("切换同楼座场地时只更新目标助理的 Dock 位置", () => {
  const before = [assistant("assistant-a", "101"), assistant("assistant-b", "102")];
  const after = patchAssistantDockRoom(before, "assistant-a", "大厅");

  assert.equal(after[0]?.currentRoom, "大厅");
  assert.equal(after[1]?.currentRoom, "102");
});

test("完整助理状态摘要会移除已离开当前楼座的 Dock 成员", () => {
  const before = [assistant("assistant-a", "101"), assistant("assistant-b", "102")];
  const after = reconcileAssistantDockSnapshot(
    before,
    [],
    [{ id: "assistant-a", currentRoom: "101", status: "idle" }],
  );

  assert.deepEqual(after.map((item) => item.id), ["assistant-a"]);
});

test("完整助理状态摘要会合并新进入楼座的 profile 与状态", () => {
  const incoming = assistant("assistant-c", "大厅");
  const after = reconcileAssistantDockSnapshot(
    [assistant("assistant-a", "101")],
    [incoming],
    [
      { id: "assistant-a", currentRoom: "101", status: "idle" },
      { id: "assistant-c", currentRoom: "大厅", status: "assigned" },
    ],
  );

  assert.deepEqual(after.map((item) => item.id), ["assistant-a", "assistant-c"]);
  assert.equal(after[1]?.status, "assigned");
});

test("完整空摘要会清空没有助理的楼座 Dock", () => {
  const after = reconcileAssistantDockSnapshot(
    [assistant("assistant-a", "101")],
    [],
    [],
  );

  assert.deepEqual(after, []);
});

test("身份切换到楼座时会立即生成当前楼座 Dock", () => {
  const after = optimisticAssistantDockForBuilding(
    [],
    [profile("assistant-a", 1, "101"), profile("assistant-b", 2, "201")],
    1,
  );

  assert.deepEqual(after.map((item) => item.id), ["assistant-a"]);
  assert.equal(after[0]?.currentRoom, "101");
});

test("助理切出当前楼座时会立即从 Dock 移除", () => {
  const before = [assistant("assistant-a", "101"), assistant("assistant-b", "102")];
  const after = optimisticAssistantDockForBuilding(
    before,
    [profile("assistant-a", 2, null), profile("assistant-b", 1, "102")],
    1,
  );

  assert.deepEqual(after.map((item) => item.id), ["assistant-b"]);
});

test("乐观楼座快照保留已有任务定位，避免任务 marker 闪烁", () => {
  const liveAssistant = {
    ...assistant("assistant-a", "任务房"),
    status: "executing",
    currentTaskId: "task-a",
    currentTask: "已进行1分钟\n任务房 · 摄影师",
  };
  const after = optimisticAssistantDockForBuilding(
    [liveAssistant],
    [profile("assistant-a", 1, "空闲点")],
    1,
  );

  assert.equal(after[0]?.currentRoom, "任务房");
  assert.equal(after[0]?.currentTaskId, "task-a");
  assert.equal(after[0]?.onlineStatus, "online");
});

test("身份面板已有新鲜缓存时直接显示，不重复刷新整表", () => {
  assert.equal(shouldRefreshIdentityProfiles({
    cachedProfileCount: 131,
    lastFetchedAt: 10_000,
    now: 18_000,
    requestInFlight: false,
    freshnessMs: 15_000,
  }), false);
});

test("身份面板缓存过期后刷新，但进行中的请求会去重", () => {
  const staleSnapshot = {
    cachedProfileCount: 131,
    lastFetchedAt: 10_000,
    now: 30_000,
    freshnessMs: 15_000,
  };

  assert.equal(shouldRefreshIdentityProfiles({ ...staleSnapshot, requestInFlight: false }), true);
  assert.equal(shouldRefreshIdentityProfiles({ ...staleSnapshot, requestInFlight: true }), false);
});

test("工作台同步内容未变化时保留身份列表引用，避免滚动中整表重绘", () => {
  const before = [
    { id: "assistant-a", name: "助理A", onlineStatus: "online", activeRoom: "101", building: { id: 1, name: "A座" } },
    { id: "assistant-b", name: "助理B", onlineStatus: "online", activeRoom: "102", building: { id: 1, name: "A座" } },
  ];
  const after = mergeIdentityProfilePatches(before, [
    { id: "assistant-a", onlineStatus: "online", activeRoom: "101", building: { id: 1, name: "A座" } },
  ]);

  assert.equal(after, before);
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
});

test("工作台同步只替换实际变化的身份行", () => {
  const before = [
    { id: "assistant-a", name: "助理A", onlineStatus: "online", activeRoom: "101", building: { id: 1, name: "A座" } },
    { id: "assistant-b", name: "助理B", onlineStatus: "online", activeRoom: "102", building: { id: 1, name: "A座" } },
  ];
  const after = mergeIdentityProfilePatches(before, [
    { id: "assistant-a", onlineStatus: "on_break" },
  ]);

  assert.notEqual(after, before);
  assert.notEqual(after[0], before[0]);
  assert.equal(after[0]?.onlineStatus, "on_break");
  assert.equal(after[1], before[1]);
});
