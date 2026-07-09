"use client";

import { useCallback, useRef } from "react";
import type { TaskFromAPI } from "./types";

const RECENT_TASK_PATCH_TTL_MS = 8_000;

type RecentTaskPatch = {
  task: TaskFromAPI;
  appliedAt: number;
};

type HiddenTaskUntil = {
  profileId: string;
  hiddenUntil: number;
};

type WorkbenchTaskOptimismProfile = {
  id: string;
};

export function useWorkbenchTaskOptimism() {
  const recentTaskPatchesRef = useRef<Map<string, RecentTaskPatch>>(new Map());
  const recentHiddenTaskUntilRef = useRef<Map<string, HiddenTaskUntil>>(new Map());

  const rememberTaskPatch = useCallback((task: TaskFromAPI, appliedAt = Date.now()) => {
    recentHiddenTaskUntilRef.current.delete(task.id);
    recentTaskPatchesRef.current.set(task.id, { task, appliedAt });
  }, []);

  const forgetTaskPatch = useCallback((taskId: string) => {
    recentTaskPatchesRef.current.delete(taskId);
  }, []);

  const hideTaskForProfile = useCallback((taskId: string, profileId: string, appliedAt = Date.now()) => {
    recentHiddenTaskUntilRef.current.set(taskId, {
      profileId,
      hiddenUntil: appliedAt + RECENT_TASK_PATCH_TTL_MS,
    });
  }, []);

  const applyOptimisticTaskPatches = useCallback((
    taskData: TaskFromAPI[],
    targetProfile: WorkbenchTaskOptimismProfile,
  ): TaskFromAPI[] => {
    const nowMs = Date.now();
    const visibleTaskData = taskData.filter((task) => {
      const hidden = recentHiddenTaskUntilRef.current.get(task.id);
      if (hidden == null) return true;
      if (hidden.hiddenUntil <= nowMs) {
        recentHiddenTaskUntilRef.current.delete(task.id);
        return true;
      }
      return hidden.profileId !== targetProfile.id;
    });

    const patchedIds = new Set<string>();
    const patchedTaskData = visibleTaskData.map((task) => {
      const patch = recentTaskPatchesRef.current.get(task.id);
      if (!patch) return task;
      if (nowMs - patch.appliedAt > RECENT_TASK_PATCH_TTL_MS) {
        recentTaskPatchesRef.current.delete(task.id);
        return task;
      }
      patchedIds.add(task.id);
      return { ...task, ...patch.task };
    });

    for (const [taskId, patch] of recentTaskPatchesRef.current) {
      if (nowMs - patch.appliedAt > RECENT_TASK_PATCH_TTL_MS) {
        recentTaskPatchesRef.current.delete(taskId);
        continue;
      }
      const hidden = recentHiddenTaskUntilRef.current.get(taskId);
      if (hidden != null) {
        if (hidden.hiddenUntil <= nowMs) {
          recentHiddenTaskUntilRef.current.delete(taskId);
        } else if (hidden.profileId === targetProfile.id) {
          continue;
        }
      }
      if (!patchedIds.has(taskId) && !patchedTaskData.some((task) => task.id === taskId)) {
        patchedTaskData.push(patch.task);
      }
    }

    return patchedTaskData;
  }, []);

  return {
    applyOptimisticTaskPatches,
    forgetTaskPatch,
    hideTaskForProfile,
    rememberTaskPatch,
  };
}
