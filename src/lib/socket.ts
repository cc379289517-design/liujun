import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { SOCKET_EVENTS } from "@/types";

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HTTPServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // 加入角色房间
    socket.on("join:role", (role: string) => {
      socket.join(`role:${role}`);
      console.log(`[Socket] ${socket.id} joined role:${role}`);
    });

    // 加入楼座房间
    socket.on("join:building", (buildingId: number) => {
      socket.join(`building:${buildingId}`);
      console.log(`[Socket] ${socket.id} joined building:${buildingId}`);
    });

    // 加入个人房间（用于定向推送）
    socket.on("join:user", (userId: string) => {
      socket.join(`user:${userId}`);
      console.log(`[Socket] ${socket.id} joined user:${userId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * 广播任务创建事件
 */
export function emitTaskCreated(task: unknown) {
  io?.emit(SOCKET_EVENTS.TASK_CREATED, task);
}

/**
 * 广播任务更新事件
 */
export function emitTaskUpdated(task: unknown) {
  io?.emit(SOCKET_EVENTS.TASK_UPDATED, task);
}

/**
 * 向特定用户发送紧急任务通知
 */
export function emitUrgentAlert(userId: string, task: unknown) {
  io?.to(`user:${userId}`).emit(SOCKET_EVENTS.ALERT_URGENT, task);
}

/**
 * 广播用户状态变更
 */
export function emitProfileUpdated(profile: unknown) {
  io?.emit(SOCKET_EVENTS.PROFILE_UPDATED, profile);
}

/**
 * 广播结项预警
 */
export function emitCompletionAlert(task: unknown) {
  io?.emit(SOCKET_EVENTS.ALERT_COMPLETION, task);
}
