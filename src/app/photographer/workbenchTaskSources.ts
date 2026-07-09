type TaskSourceItem = {
  id: string;
};

type UpsertTaskInListOptions = {
  position?: "append" | "prepend";
  mergeExisting?: boolean;
  moveExisting?: boolean;
};

export function updateTaskInList<T extends TaskSourceItem>(
  list: T[],
  taskId: string,
  updateTask: (task: T) => T,
): T[] {
  let changed = false;
  const next = list.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    return updateTask(task);
  });
  return changed ? next : list;
}

export function removeTaskFromList<T extends TaskSourceItem>(list: T[], taskId: string): T[] {
  const next = list.filter((task) => task.id !== taskId);
  return next.length === list.length ? list : next;
}

export function upsertTaskInList<T extends TaskSourceItem>(
  list: T[],
  task: T,
  options: UpsertTaskInListOptions = {},
): T[] {
  const position = options.position ?? "append";
  const existingIndex = list.findIndex((item) => item.id === task.id);
  if (existingIndex < 0) {
    return position === "prepend" ? [task, ...list] : [...list, task];
  }

  const nextTask = options.mergeExisting ? { ...list[existingIndex], ...task } : task;
  if (options.moveExisting) {
    const withoutTask = removeTaskFromList(list, task.id);
    return position === "prepend" ? [nextTask, ...withoutTask] : [...withoutTask, nextTask];
  }

  const next = list.slice();
  next[existingIndex] = nextTask;
  return next;
}

export function replaceOrRemoveTaskInList<T extends TaskSourceItem>(
  list: T[],
  task: T,
  keepTask: boolean,
): T[] {
  const withoutTask = removeTaskFromList(list, task.id);
  return keepTask ? [...withoutTask, task] : withoutTask;
}
