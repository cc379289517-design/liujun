import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  collaborationInvitationDisplay,
  incomingCollaborationInvitationForProfile,
} from "../../src/app/photographer/collaborationInvitationDisplay";
import type { CollaborationInvitationFromAPI } from "../../src/app/photographer/types";

function invitation(overrides: Partial<CollaborationInvitationFromAPI> = {}): CollaborationInvitationFromAPI {
  return {
    id: "invitation-1",
    taskId: "task-1",
    inviterProfileId: "assistant-from",
    targetAssistantId: "assistant-target",
    status: "pending",
    reason: null,
    requestedAt: "2026-07-21T09:05:00.000Z",
    respondedAt: null,
    canceledAt: null,
    updatedAt: "2026-07-21T09:05:00.000Z",
    inviterProfile: { id: "assistant-from", name: "黄桂兰", role: "assistant" },
    targetAssistant: { id: "assistant-target", name: "黄婷" },
    task: {
      id: "task-1",
      roomNumber: "301",
      priority: 3,
      status: "executing",
      category: { id: 7, name: "熨烫", minDuration: 15, maxDuration: 30, estDuration: 20 },
      photographer: { id: "photographer-1", name: "曾紫玥" },
    },
    ...overrides,
  };
}

test("只有目标助理会收到待确认协作邀请，关闭后本轮可暂时隐藏", () => {
  const pending = invitation();
  const incoming = incomingCollaborationInvitationForProfile([pending], "assistant-target", []);
  assert(incoming);
  assert.equal(incoming.id, pending.id);
  assert.equal(
    incomingCollaborationInvitationForProfile([pending], "assistant-from", []),
    null,
  );
  assert.equal(
    incomingCollaborationInvitationForProfile([pending], "assistant-target", [pending.id]),
    null,
  );
});

test("协作邀请文案包含发起人、房间、任务类型和时长", () => {
  const display = collaborationInvitationDisplay(invitation());

  assert.equal(display.title, "收到协作邀请");
  assert.match(display.summary, /301室/);
  assert.match(display.summary, /熨烫/);
  assert.match(display.summary, /15-30分钟/);
  assert.match(display.message, /黄桂兰/);
  assert.equal(display.acceptLabel, "接受协作");
  assert.equal(display.rejectLabel, "拒绝");
});

test("协作邀请提示位于手机与桌面共用层，不受桌面容器隐藏影响", () => {
  const pageSource = readFileSync(
    new URL("../../src/app/photographer/page.tsx", import.meta.url),
    "utf8",
  );
  const invitationPromptIndex = pageSource.indexOf("待处理协作邀请");
  const mobileWorkbenchIndex = pageSource.indexOf("{renderMobileWorkbench()}");
  const desktopOnlyRootIndex = pageSource.indexOf("hidden overflow-hidden transition-colors duration-700 lg:block");

  assert(invitationPromptIndex >= 0, "页面应保留待处理协作邀请入口");
  assert(mobileWorkbenchIndex >= 0, "页面应保留移动工作台入口");
  assert(desktopOnlyRootIndex >= 0, "页面应保留桌面专用根容器");
  assert(
    invitationPromptIndex < mobileWorkbenchIndex && invitationPromptIndex < desktopOnlyRootIndex,
    "协作邀请提示必须放在手机与桌面共用层，不能嵌套在桌面专用容器中",
  );
});
