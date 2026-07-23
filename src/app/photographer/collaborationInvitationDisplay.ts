import type { CollaborationInvitationFromAPI } from "./types";

export type CollaborationInvitationDisplay = {
  title: string;
  summary: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
};

function durationLabel(invitation: CollaborationInvitationFromAPI): string {
  const { minDuration, maxDuration, estDuration } = invitation.task.category;
  if (minDuration != null && maxDuration != null) {
    return minDuration === maxDuration
      ? `${minDuration}分钟`
      : `${minDuration}-${maxDuration}分钟`;
  }
  const fallback = estDuration ?? minDuration ?? maxDuration;
  return fallback != null ? `${fallback}分钟` : "时长待定";
}

export function incomingCollaborationInvitationForProfile(
  invitations: CollaborationInvitationFromAPI[],
  profileId: string | null | undefined,
  dismissedInvitationIds: string[],
): CollaborationInvitationFromAPI | null {
  if (!profileId) return null;
  return invitations.find((invitation) =>
    invitation.status === "pending" &&
    invitation.targetAssistantId === profileId &&
    !dismissedInvitationIds.includes(invitation.id)
  ) ?? null;
}

export function collaborationInvitationDisplay(
  invitation: CollaborationInvitationFromAPI,
): CollaborationInvitationDisplay {
  const task = invitation.task;
  return {
    title: "收到协作邀请",
    summary: `${task.roomNumber}室 · ${task.category.name} · ${durationLabel(invitation)}`,
    message: `${invitation.inviterProfile.name}邀请你参与该任务协作。接受后你将进入待就位状态，请确认当前安排后再处理。`,
    acceptLabel: "接受协作",
    rejectLabel: "拒绝",
  };
}
