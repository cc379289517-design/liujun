"use client";

import { useState, useEffect, useCallback } from "react";

interface WaitingTask {
  id: number;
  categoryName?: string;
  room?: string;
  photographerName?: string;
  assistantName?: string;
  createdAt: string;
  isSpecified?: boolean;
}

interface Props {
  config: Record<string, { value: string; label: string | null }>;
  onRefresh: () => void;
}

export default function ApprovalTab({ config, onRefresh }: Props) {
  const [tasks, setTasks] = useState<WaitingTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch waiting tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks?status=waiting");
      if (res.ok) {
        const data: WaitingTask[] = await res.json();
        setTasks(data.filter((t) => t.isSpecified === true));
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Approve
  const handleApprove = async (id: number) => {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      fetchTasks();
      onRefresh();
    } catch {}
  };

  // Reject
  const handleReject = async (id: number) => {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      fetchTasks();
      onRefresh();
    } catch {}
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      {/* Approval section */}
      <div>
        <h3 className="text-sm font-semibold text-[--text-primary] mb-3">
          审批中心
        </h3>
        {loading ? (
          <div className="text-center text-sm text-gray-400 py-8">
            加载中...
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">
            暂无待审批任务
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        {task.categoryName ?? "任务"}
                      </span>
                      {task.room && (
                        <span className="text-xs text-gray-400">
                          {task.room}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      {task.photographerName && (
                        <div>摄影师: {task.photographerName}</div>
                      )}
                      {task.assistantName && (
                        <div>指定助理: {task.assistantName}</div>
                      )}
                      <div className="text-gray-400">
                        {formatTime(task.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      className="px-3 py-1.5 text-xs rounded-lg text-white font-medium bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 transition"
                      onClick={() => handleApprove(task.id)}
                    >
                      批准
                    </button>
                    <button
                      className="px-3 py-1.5 text-xs rounded-lg font-medium bg-red-50 text-red-600 hover:bg-red-100 transition"
                      onClick={() => handleReject(task.id)}
                    >
                      驳回
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
