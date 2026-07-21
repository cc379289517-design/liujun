import assert from "node:assert/strict";
import test from "node:test";

import { reassignmentNoticeDisplay } from "../../src/app/photographer/reassignmentNoticeDisplay";
import type { StandbyReassignmentNoticeFromAPI } from "../../src/app/photographer/types";

function notice(reason: string, overrides: Partial<StandbyReassignmentNoticeFromAPI> = {}): StandbyReassignmentNoticeFromAPI {
  return {
    id: "notice-1",
    taskId: "task-1",
    oldAssistantId: "assistant-old",
    oldAssistantName: "原助理",
    newAssistantId: "assistant-new",
    newAssistantName: "接手助理",
    taskRoomNumber: "301",
    taskCategoryName: "熨烫",
    taskPriority: 2,
    waitedMinutes: 20,
    thresholdMinutes: 20,
    score: 1,
    reason,
    oldAssistantSetOffline: false,
    oldAssistantActiveTaskRoomNumber: "201",
    oldAssistantActiveTaskCategoryName: "手持",
    oldAssistantActiveTaskStatus: "executing",
    newAssistantAcknowledgedAt: null,
    oldAssistantAcknowledgedAt: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

for (const reason of ["ironing_wait_load_balance", "unselected_standby_release", "standby_timeout_offline"]) {
  test(`${reason} 对转出方和接手方都明确显示为系统自动转派`, () => {
    for (const role of ["old", "new"] as const) {
      const display = reassignmentNoticeDisplay(notice(reason), role);
      assert.equal(display.source, "system");
      assert.equal(display.title, "系统自动转派通知");
      assert.match(display.message, /系统/);
      assert.doesNotMatch(display.message, /向你发起/);
    }
  });
}

test("助理主动交换继续显示发起人和人工申请语义", () => {
  const oldDisplay = reassignmentNoticeDisplay(notice("assistant_requested_swap"), "old");
  const newDisplay = reassignmentNoticeDisplay(notice("assistant_requested_swap"), "new");

  assert.equal(oldDisplay.source, "manual");
  assert.match(oldDisplay.title, /申请已发出/);
  assert.match(newDisplay.title, /接替\/交换申请/);
  assert.match(newDisplay.message, /原助理向你发起/);
  assert.doesNotMatch(newDisplay.message, /系统自动转派/);
});

test("双方已确认的延后交换就绪时不再显示成新申请", () => {
  for (const role of ["old", "new"] as const) {
    const display = reassignmentNoticeDisplay(notice("assistant_swap_after_complete_ready"), role);
    assert.equal(display.source, "confirmed_swap");
    assert.equal(display.title, "已确认的交换现已就绪");
    assert.match(display.message, /此前双方已确认/);
    assert.doesNotMatch(display.message, /发起.*申请/);
  }
});

test("系统自动转派不会因原助理保持在线而退化成人工交换文案", () => {
  const display = reassignmentNoticeDisplay(
    notice("unselected_standby_release", { oldAssistantSetOffline: false }),
    "old",
  );

  assert.equal(display.source, "system");
  assert.equal(display.buttonLabel, "知道了");
});

test("无替代助理时通知公共队列释放且在线状态未改变", () => {
  const display = reassignmentNoticeDisplay(
    notice("standby_timeout_no_replacement", { oldAssistantSetOffline: false }),
    "old",
  );

  assert.equal(display.source, "system");
  assert.match(display.message, /公共队列/);
  assert.match(display.message, /在线状态未改变/);
  assert.doesNotMatch(display.message, /切换为离线/);
  assert.equal(display.buttonLabel, "知道了");
});

test("准备熨烫无替代助理时明确保留原归属且不误报公共队列", () => {
  const display = reassignmentNoticeDisplay(
    notice("standby_timeout_ironing_retained", { oldAssistantSetOffline: false }),
    "old",
  );

  assert.equal(display.source, "system");
  assert.match(display.message, /仍保留在你名下/);
  assert.match(display.message, /在线状态未改变/);
  assert.doesNotMatch(display.message, /公共队列/);
  assert.doesNotMatch(display.message, /切换为离线/);
  assert.equal(display.buttonLabel, "知道了");
});
