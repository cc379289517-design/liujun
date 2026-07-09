"use client";

import { useCallback, useReducer, useRef } from "react";
import type { TaskFromAPI } from "./types";
import {
  removeTaskFromList,
  replaceOrRemoveTaskInList,
  updateTaskInList,
  upsertTaskInList,
  type UpsertTaskInListOptions,
} from "./workbenchTaskSources";

type WorkbenchTaskSourceSnapshot = {
  tasks: TaskFromAPI[];
  tasksById: Map<string, TaskFromAPI>;
  orderedIds: string[];
};

type WorkbenchTaskSourceAction =
  | { type: "replace"; tasks: TaskFromAPI[] }
  | { type: "update"; taskId: string; updateTask: (task: TaskFromAPI) => TaskFromAPI }
  | { type: "remove"; taskId: string }
  | { type: "upsert"; task: TaskFromAPI; options?: UpsertTaskInListOptions }
  | { type: "replace-or-remove"; task: TaskFromAPI; keepTask: boolean };

function buildTaskSourceSnapshot(tasks: TaskFromAPI[]): WorkbenchTaskSourceSnapshot {
  return {
    tasks,
    tasksById: new Map(tasks.map((task) => [task.id, task])),
    orderedIds: tasks.map((task) => task.id),
  };
}

function taskSourceReducer(
  state: WorkbenchTaskSourceSnapshot,
  action: WorkbenchTaskSourceAction,
): WorkbenchTaskSourceSnapshot {
  if (action.type === "replace") {
    return action.tasks === state.tasks ? state : buildTaskSourceSnapshot(action.tasks);
  }

  const nextTasks = action.type === "update"
    ? updateTaskInList(state.tasks, action.taskId, action.updateTask)
    : action.type === "remove"
      ? removeTaskFromList(state.tasks, action.taskId)
      : action.type === "upsert"
        ? upsertTaskInList(state.tasks, action.task, action.options)
        : replaceOrRemoveTaskInList(state.tasks, action.task, action.keepTask);

  return nextTasks === state.tasks ? state : buildTaskSourceSnapshot(nextTasks);
}

export function useWorkbenchTaskSourceStore(initialTasks: TaskFromAPI[] = []) {
  const [snapshot, dispatchBase] = useReducer(
    taskSourceReducer,
    initialTasks,
    buildTaskSourceSnapshot,
  );
  const snapshotRef = useRef(snapshot);
  const tasksRef = useRef(snapshot.tasks);
  const tasksByIdRef = useRef(snapshot.tasksById);
  const orderedIdsRef = useRef(snapshot.orderedIds);

  const dispatchTaskSource = useCallback((action: WorkbenchTaskSourceAction): TaskFromAPI[] => {
    const nextSnapshot = taskSourceReducer(snapshotRef.current, action);
    if (nextSnapshot !== snapshotRef.current) {
      snapshotRef.current = nextSnapshot;
      tasksRef.current = nextSnapshot.tasks;
      tasksByIdRef.current = nextSnapshot.tasksById;
      orderedIdsRef.current = nextSnapshot.orderedIds;
      dispatchBase(action);
    }
    return nextSnapshot.tasks;
  }, []);

  const replaceTasks = useCallback((tasks: TaskFromAPI[]) => (
    dispatchTaskSource({ type: "replace", tasks })
  ), [dispatchTaskSource]);

  const updateTask = useCallback((
    taskId: string,
    updateRawTask: (task: TaskFromAPI) => TaskFromAPI,
  ) => (
    dispatchTaskSource({ type: "update", taskId, updateTask: updateRawTask })
  ), [dispatchTaskSource]);

  const removeTask = useCallback((taskId: string) => (
    dispatchTaskSource({ type: "remove", taskId })
  ), [dispatchTaskSource]);

  const upsertTask = useCallback((task: TaskFromAPI, options?: UpsertTaskInListOptions) => (
    dispatchTaskSource({ type: "upsert", task, options })
  ), [dispatchTaskSource]);

  const replaceOrRemoveTask = useCallback((task: TaskFromAPI, keepTask: boolean) => (
    dispatchTaskSource({ type: "replace-or-remove", task, keepTask })
  ), [dispatchTaskSource]);

  const getTask = useCallback((taskId: string) => (
    tasksByIdRef.current.get(taskId) ?? null
  ), []);

  return {
    orderedIds: snapshot.orderedIds,
    orderedIdsRef,
    replaceOrRemoveTask,
    replaceTasks,
    removeTask,
    tasks: snapshot.tasks,
    tasksById: snapshot.tasksById,
    tasksByIdRef,
    tasksRef,
    getTask,
    updateTask,
    upsertTask,
  };
}
