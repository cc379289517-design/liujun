import assert from "node:assert/strict";
import test from "node:test";

import {
  photographerDailyResetLocation,
  schedulePhotographerDailyLocationReset,
} from "../../src/app/photographer/locationDisplay";

test("摄影师跨自然日复位到登记楼座和登记办公室", () => {
  assert.deepEqual(
    photographerDailyResetLocation({ role: "photographer", buildingId: 2, currentRoom: "办公室" }),
    { buildingId: 2, room: "办公室", needsOfficePrompt: false },
  );
});

test("摄影师没有登记办公室时复位到登记楼座并提示补充地点", () => {
  assert.deepEqual(
    photographerDailyResetLocation({ role: "photographer", buildingId: 2, currentRoom: "  " }),
    { buildingId: 2, room: null, needsOfficePrompt: true },
  );
});

test("助理不参与摄影师的每日位置复位", () => {
  assert.equal(
    photographerDailyResetLocation({ role: "assistant", buildingId: 2, currentRoom: "办公室" }),
    null,
  );
});

test("页面长期打开时每个本地零点都会再次安排摄影师位置复位", () => {
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  let nextTimerId = 1;
  let resetCount = 0;
  let nowMs = new Date(2026, 6, 23, 23, 59, 30).getTime();

  const stop = schedulePhotographerDailyLocationReset(
    () => {
      resetCount += 1;
    },
    () => nowMs,
    (callback, delayMs) => {
      const timerId = nextTimerId++;
      callbacks.set(timerId, callback);
      delays.push(delayMs);
      return timerId;
    },
    (timerId) => {
      cleared.push(timerId);
      callbacks.delete(timerId);
    },
  );

  assert.equal(callbacks.size, 1);
  assert.equal(delays[0], 30_000);

  const firstMidnightCallback = callbacks.get(1);
  assert(firstMidnightCallback);
  callbacks.delete(1);
  nowMs = new Date(2026, 6, 24, 0, 0, 0).getTime();
  firstMidnightCallback();

  assert.equal(resetCount, 1);
  assert.equal(callbacks.size, 1);
  assert.equal(delays[1], 24 * 60 * 60 * 1000);

  const secondMidnightCallback = callbacks.get(2);
  assert(secondMidnightCallback);
  callbacks.delete(2);
  nowMs = new Date(2026, 6, 25, 0, 0, 0).getTime();
  secondMidnightCallback();

  assert.equal(resetCount, 2);
  assert.equal(callbacks.size, 1);

  stop();
  assert.deepEqual(cleared, [3]);
  assert.equal(callbacks.size, 0);
});
