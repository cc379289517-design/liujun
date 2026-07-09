"use client";

import { useCallback, useReducer, useRef } from "react";

export type WorkbenchPendingAction =
  | "start"
  | "complete"
  | "pause"
  | "resume"
  | "cancel"
  | "create"
  | "create-mobile"
  | "transfer"
  | "transfer-response"
  | "priority-upgrade";

type PendingActionState = string[];

type PendingActionEvent =
  | { type: "begin"; actionKey: string }
  | { type: "end"; actionKey: string };

function pendingActionReducer(state: PendingActionState, event: PendingActionEvent): PendingActionState {
  if (event.type === "begin") {
    return state.includes(event.actionKey) ? state : [...state, event.actionKey];
  }
  return state.filter((key) => key !== event.actionKey);
}

export function workbenchTaskActionKey(action: WorkbenchPendingAction, taskId: string, actorId?: string | null): string {
  return `${action}:${actorId ?? "unknown"}:${taskId}`;
}

export function workbenchProfileActionKey(action: WorkbenchPendingAction, profileId?: string | null): string {
  return `${action}:${profileId ?? "unknown"}`;
}

export function useWorkbenchPendingActions() {
  const pendingActionRef = useRef<Set<string>>(new Set());
  const [pendingActionKeys, dispatchPendingAction] = useReducer(pendingActionReducer, []);

  const beginPendingAction = useCallback((actionKey: string): boolean => {
    if (pendingActionRef.current.has(actionKey)) return false;
    pendingActionRef.current.add(actionKey);
    dispatchPendingAction({ type: "begin", actionKey });
    return true;
  }, []);

  const endPendingAction = useCallback((actionKey: string) => {
    pendingActionRef.current.delete(actionKey);
    dispatchPendingAction({ type: "end", actionKey });
  }, []);

  const isPendingAction = useCallback((actionKey: string) => (
    pendingActionKeys.includes(actionKey)
  ), [pendingActionKeys]);

  return {
    pendingActionKeys,
    beginPendingAction,
    endPendingAction,
    isPendingAction,
  };
}
