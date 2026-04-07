"use client";

import { Press_Start_2P } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

const GRID_W = 24;
const GRID_H = 24;
const CELL = 18;

const SPEED_LEVELS = [
  { id: "chill", label: "悠闲", tickMs: 180 },
  { id: "normal", label: "标准", tickMs: 110 },
  { id: "fast", label: "快速", tickMs: 75 },
  { id: "extreme", label: "极速", tickMs: 48 },
] as const;

const LB_KEY = "snake-leaderboard";
const SPEED_KEY = "snake-speed-index";
const HIGH_KEY = "snake-high";
const THEME_HEAD_KEY = "snake-theme-head";
const THEME_BODY_KEY = "snake-theme-body";
const SKIN_KEY = "snake-skin-id";
const LB_MAX = 20;

const DEFAULT_SNAKE_HEAD = "#ff69b4";
const DEFAULT_SNAKE_BODY = "#f9a8d4";

const THEME_PRESETS = [
  { name: "经典粉", head: "#ff69b4", body: "#f9a8d4" },
  { name: "电光青", head: "#22d3ee", body: "#67e8f9" },
  { name: "蜜瓜绿", head: "#4ade80", body: "#86efac" },
  { name: "葡萄紫", head: "#a78bfa", body: "#c4b5fd" },
  { name: "柠檬黄", head: "#facc15", body: "#fde047" },
  { name: "珊瑚橙", head: "#fb923c", body: "#fdba74" },
] as const;

const SKINS = [
  {
    id: "classic",
    name: "经典粉块",
    blurb: "方头方身 + 豆豆眼",
  },
  {
    id: "ribbon",
    name: "蝴蝶结",
    blurb: "头顶小蝴蝶结",
  },
  {
    id: "candy",
    name: "糖果条纹",
    blurb: "一节深一节浅",
  },
  {
    id: "neon",
    name: "霓虹描边",
    blurb: "高对比描边",
  },
  {
    id: "checker",
    name: "像素棋盘",
    blurb: "躯干棋盘格",
  },
  {
    id: "retro8",
    name: "8-bit 高光",
    blurb: "掌机风厚像素",
  },
] as const;

type SkinId = (typeof SKINS)[number]["id"];

type Point = { x: number; y: number };

export type SnakeLeaderEntry = {
  id: string;
  name: string;
  score: number;
  speedLabel: string;
  tickMs: number;
  at: number;
  /** 皮肤 id，旧数据可能没有 */
  skinId?: string;
  skinName?: string;
};

const COLORS = {
  bg: "#2d1528",
  grid: "#4a2444",
  food: "#f472b6",
  foodGlow: "#fda4af",
  accent: "#fce7f3",
  shadow: "#1a0d18",
} as const;

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = Number.parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 躯干色向白色混合，作为尾部像素块颜色 */
function tailFromBody(bodyHex: string): string {
  const p = parseHex(bodyHex.startsWith("#") ? bodyHex : `#${bodyHex}`);
  if (!p) return "#fbcfe8";
  const t = 0.38;
  return rgbToHex(
    p.r + (255 - p.r) * t,
    p.g + (255 - p.g) * t,
    p.b + (255 - p.b) * t,
  );
}

function normalizeHexInput(v: string): string {
  const t = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t}`;
  return "";
}

function randomCell(avoid: Point[]): Point {
  let p: Point;
  do {
    p = {
      x: Math.floor(Math.random() * GRID_W),
      y: Math.floor(Math.random() * GRID_H),
    };
  } while (avoid.some((q) => q.x === p.x && q.y === p.y));
  return p;
}

function sortLeaderboard(entries: SnakeLeaderEntry[]): SnakeLeaderEntry[] {
  return [...entries].sort(
    (a, b) => b.score - a.score || b.at - a.at,
  );
}

function loadLeaderboardRaw(): SnakeLeaderEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SnakeLeaderEntry =>
        e &&
        typeof e === "object" &&
        typeof (e as SnakeLeaderEntry).id === "string" &&
        typeof (e as SnakeLeaderEntry).name === "string" &&
        typeof (e as SnakeLeaderEntry).score === "number",
    );
  } catch {
    return [];
  }
}

function saveLeaderboard(entries: SnakeLeaderEntry[]) {
  localStorage.setItem(LB_KEY, JSON.stringify(entries));
}

export default function SnakePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirRef = useRef<Point>({ x: 1, y: 0 });
  const pendingDirRef = useRef<Point>({ x: 1, y: 0 });
  const snakeRef = useRef<Point[]>([
    { x: 5, y: 12 },
    { x: 4, y: 12 },
    { x: 3, y: 12 },
  ]);
  const foodRef = useRef<Point>({ x: 14, y: 12 });
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [leaderboard, setLeaderboard] = useState<SnakeLeaderEntry[]>([]);
  const [finalScore, setFinalScore] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const [rankSubmitted, setRankSubmitted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [snakeHeadHex, setSnakeHeadHex] = useState(DEFAULT_SNAKE_HEAD);
  const [snakeBodyHex, setSnakeBodyHex] = useState(DEFAULT_SNAKE_BODY);

  const tickMs = SPEED_LEVELS[speedIndex]?.tickMs ?? SPEED_LEVELS[1].tickMs;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = GRID_W * CELL;
    const h = GRID_H * CELL;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_W; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_H; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(w, y * CELL + 0.5);
      ctx.stroke();
    }

    const food = foodRef.current;
    ctx.fillStyle = COLORS.foodGlow;
    ctx.fillRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = COLORS.food;
    ctx.fillRect(food.x * CELL + 4, food.y * CELL + 4, CELL - 8, CELL - 8);

    const snake = snakeRef.current;
    snake.forEach((seg, i) => {
      const pad = i === 0 ? 2 : 3;
      const inner = CELL - pad * 2;
      const headC = snakeHeadHex;
      const bodyC = snakeBodyHex;
      const tailC = tailFromBody(bodyC);
      ctx.fillStyle =
        i === 0 ? headC : i === snake.length - 1 ? tailC : bodyC;
      ctx.fillRect(seg.x * CELL + pad, seg.y * CELL + pad, inner, inner);
      if (i === 0) {
        ctx.fillStyle = COLORS.shadow;
        const eye = 3;
        const ox = dirRef.current.x > 0 ? 6 : dirRef.current.x < 0 ? 2 : 4;
        const oy = dirRef.current.y > 0 ? 6 : dirRef.current.y < 0 ? 2 : 4;
        ctx.fillRect(seg.x * CELL + ox, seg.y * CELL + oy, eye, eye);
        ctx.fillRect(seg.x * CELL + ox + 5, seg.y * CELL + oy, eye, eye);
      }
    });
  }, [snakeBodyHex, snakeHeadHex]);

  const resetGame = useCallback(() => {
    snakeRef.current = [
      { x: 5, y: 12 },
      { x: 4, y: 12 },
      { x: 3, y: 12 },
    ];
    dirRef.current = { x: 1, y: 0 };
    pendingDirRef.current = { x: 1, y: 0 };
    foodRef.current = randomCell(snakeRef.current);
    setScore(0);
    setGameOver(false);
    setStarted(true);
    setFinalScore(0);
    setPendingName("");
    setRankSubmitted(false);
    setPaused(false);
    draw();
  }, [draw]);

  const applyLeaderboard = useCallback((entries: SnakeLeaderEntry[]) => {
    const sorted = sortLeaderboard(entries).slice(0, LB_MAX);
    setLeaderboard(sorted);
    saveLeaderboard(sorted);
    const top = sorted[0]?.score ?? 0;
    setHighScore((h) => {
      const next = Math.max(h, top);
      localStorage.setItem(HIGH_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const high = Number(localStorage.getItem(HIGH_KEY) || "0");
    if (!Number.isNaN(high)) {
      queueMicrotask(() => setHighScore((h) => Math.max(h, high)));
    }
    const si = Number(localStorage.getItem(SPEED_KEY) || "1");
    if (!Number.isNaN(si) && si >= 0 && si < SPEED_LEVELS.length) {
      queueMicrotask(() => setSpeedIndex(si));
    }
    const nh = normalizeHexInput(localStorage.getItem(THEME_HEAD_KEY) || "");
    const nb = normalizeHexInput(localStorage.getItem(THEME_BODY_KEY) || "");
    if (nh) queueMicrotask(() => setSnakeHeadHex(nh));
    if (nb) queueMicrotask(() => setSnakeBodyHex(nb));
    queueMicrotask(() => {
      const raw = loadLeaderboardRaw();
      if (raw.length) applyLeaderboard(raw);
    });
  }, [applyLeaderboard]);

  useEffect(() => {
    draw();
  }, [draw]);

  const setSpeedLevel = useCallback((index: number) => {
    if (index < 0 || index >= SPEED_LEVELS.length) return;
    setSpeedIndex(index);
    localStorage.setItem(SPEED_KEY, String(index));
  }, []);

  const setHeadColor = useCallback((hex: string) => {
    const n = normalizeHexInput(hex);
    if (!n) return;
    setSnakeHeadHex(n);
    localStorage.setItem(THEME_HEAD_KEY, n);
  }, []);

  const setBodyColor = useCallback((hex: string) => {
    const n = normalizeHexInput(hex);
    if (!n) return;
    setSnakeBodyHex(n);
    localStorage.setItem(THEME_BODY_KEY, n);
  }, []);

  const applyPreset = useCallback((head: string, body: string) => {
    const h = normalizeHexInput(head);
    const b = normalizeHexInput(body);
    if (h) {
      setSnakeHeadHex(h);
      localStorage.setItem(THEME_HEAD_KEY, h);
    }
    if (b) {
      setSnakeBodyHex(b);
      localStorage.setItem(THEME_BODY_KEY, b);
    }
  }, []);

  const submitRank = useCallback(() => {
    if (finalScore <= 0 || rankSubmitted) return;
    const level = SPEED_LEVELS[speedIndex] ?? SPEED_LEVELS[1];
    const name =
      pendingName.trim().slice(0, 12) || "匿名";
    const entry: SnakeLeaderEntry = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      name,
      score: finalScore,
      speedLabel: level.label,
      tickMs: level.tickMs,
      at: Date.now(),
    };
    applyLeaderboard([...leaderboard, entry]);
    setRankSubmitted(true);
    setHighScore((h) => {
      const next = Math.max(h, finalScore);
      localStorage.setItem(HIGH_KEY, String(next));
      return next;
    });
  }, [
    applyLeaderboard,
    finalScore,
    leaderboard,
    pendingName,
    rankSubmitted,
    speedIndex,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === " " && (tag === "INPUT" || tag === "TEXTAREA")) return;

      if (e.key === " ") {
        if (started && !gameOver) {
          e.preventDefault();
          setPaused((p) => !p);
        }
        return;
      }

      let nx = pendingDirRef.current.x;
      let ny = pendingDirRef.current.y;
      let matched = false;
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          ny = -1;
          nx = 0;
          matched = true;
          break;
        case "ArrowDown":
        case "s":
        case "S":
          ny = 1;
          nx = 0;
          matched = true;
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          nx = -1;
          ny = 0;
          matched = true;
          break;
        case "ArrowRight":
        case "d":
        case "D":
          nx = 1;
          ny = 0;
          matched = true;
          break;
        default:
          break;
      }

      if (!matched) return;

      if (!started && !gameOver) {
        const cur = dirRef.current;
        if (nx !== -cur.x || ny !== -cur.y) {
          pendingDirRef.current = { x: nx, y: ny };
          dirRef.current = { x: nx, y: ny };
        }
        e.preventDefault();
        setStarted(true);
        return;
      }

      if (!started || gameOver) return;
      if (paused) return;

      const cur = dirRef.current;
      if (nx === -cur.x && ny === -cur.y) return;
      pendingDirRef.current = { x: nx, y: ny };
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, gameOver, paused, resetGame]);

  useEffect(() => {
    if (!started || gameOver || paused) return;

    const id = window.setInterval(() => {
      dirRef.current = pendingDirRef.current;
      const head = snakeRef.current[0];
      const d = dirRef.current;
      const next: Point = {
        x: ((head.x + d.x) % GRID_W + GRID_W) % GRID_W,
        y: ((head.y + d.y) % GRID_H + GRID_H) % GRID_H,
      };

      if (snakeRef.current.some((s) => s.x === next.x && s.y === next.y)) {
        const pts = Math.max(0, (snakeRef.current.length - 3) * 10);
        setFinalScore(pts);
        setHighScore((h) => {
          const nextH = Math.max(h, pts);
          localStorage.setItem(HIGH_KEY, String(nextH));
          return nextH;
        });
        setPaused(false);
        setGameOver(true);
        return;
      }

      const food = foodRef.current;
      const ate = next.x === food.x && next.y === food.y;
      const newSnake = [next, ...snakeRef.current];
      if (!ate) newSnake.pop();
      else {
        foodRef.current = randomCell(newSnake);
        setScore((s) => s + 10);
      }
      snakeRef.current = newSnake;
      draw();
    }, tickMs);

    return () => clearInterval(id);
  }, [started, gameOver, paused, draw, tickMs]);

  const w = GRID_W * CELL;
  const h = GRID_H * CELL;
  const speedLocked = started && !gameOver;
  const themeLocked = started && !gameOver && !paused;

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center gap-6 p-6 pb-12 bg-gradient-to-b from-[#3d1f38] via-[#2d1528] to-[#1a0d18] ${pixelFont.className}`}
    >
      <div className="text-center space-y-2">
        <h1 className="text-[#fce7f3] text-lg sm:text-xl tracking-widest drop-shadow-[0_2px_0_#831843]">
          像素贪吃蛇
        </h1>
        <p className="text-[#f9a8d4]/80 text-[10px] sm:text-xs max-w-md mx-auto leading-relaxed">
          方向键或 WASD · 穿墙环绕 · 空格暂停/继续 · 结束对局后点「再玩一次」
        </p>
      </div>

      <div className="w-full max-w-4xl flex flex-col lg:flex-row gap-8 items-start justify-center">
        <div className="flex flex-col items-center gap-4 mx-auto lg:mx-0">
          <div className="flex flex-col gap-2 w-full max-w-[min(100%,432px)]">
            <span className="text-[#fbcfe8]/90 text-[9px] tracking-wide">
              速度等级
              {speedLocked ? (
                <span className="text-[#f472b6]/80 ml-2">（对局中不可改）</span>
              ) : null}
            </span>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              {SPEED_LEVELS.map((lv, i) => (
                <button
                  key={lv.id}
                  type="button"
                  disabled={speedLocked}
                  onClick={() => setSpeedLevel(i)}
                  className={`px-3 py-1.5 text-[9px] border-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                    speedIndex === i
                      ? "bg-[#db2777] text-[#fdf2f8] border-[#fce7f3] shadow-[2px_2px_0_#831843]"
                      : "bg-[#3d1f38] text-[#f9a8d4] border-[#9d174d] hover:bg-[#4c1d3d]"
                  }`}
                >
                  {lv.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-[min(100%,432px)]">
            <span className="text-[#fbcfe8]/90 text-[9px] tracking-wide">
              装扮
              {themeLocked ? (
                <span className="text-[#f472b6]/80 ml-2">
                  （对局中不可改，可先空格暂停）
                </span>
              ) : null}
            </span>
            <div className="flex flex-wrap items-center gap-3 text-[9px] text-[#f9a8d4]">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="shrink-0">头部</span>
                <input
                  type="color"
                  value={snakeHeadHex}
                  onChange={(e) => setHeadColor(e.target.value)}
                  disabled={themeLocked}
                  className="h-7 w-12 cursor-pointer rounded border-2 border-[#9d174d] bg-[#1a0d18] disabled:opacity-45 disabled:cursor-not-allowed p-0"
                />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="shrink-0">躯干</span>
                <input
                  type="color"
                  value={snakeBodyHex}
                  onChange={(e) => setBodyColor(e.target.value)}
                  disabled={themeLocked}
                  className="h-7 w-12 cursor-pointer rounded border-2 border-[#9d174d] bg-[#1a0d18] disabled:opacity-45 disabled:cursor-not-allowed p-0"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  disabled={themeLocked}
                  onClick={() => applyPreset(p.head, p.body)}
                  className="px-2 py-1 text-[8px] border border-[#9d174d] bg-[#3d1f38] text-[#fbcfe8] hover:bg-[#4c1d3d] disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div
            className="relative p-3 rounded-sm border-4 border-[#be185d] shadow-[6px_6px_0_#831843,12px_12px_32px_rgba(0,0,0,0.45)]"
            style={{ background: "#4c1d3d" }}
          >
            <canvas
              ref={canvasRef}
              width={w}
              height={h}
              className="block [image-rendering:pixelated] [image-rendering:crisp-edges]"
              style={{ width: w, height: h }}
            />
            {!started && !gameOver && (
              <div className="absolute inset-3 flex items-center justify-center bg-[#2d1528]/85 pointer-events-none">
                <p className="text-[#fbcfe8] text-xs text-center px-4 leading-loose">
                  按方向键
                  <br />
                  开始
                </p>
              </div>
            )}
            {started && !gameOver && paused && (
              <div className="absolute inset-3 flex flex-col items-center justify-center gap-2 bg-[#2d1528]/88 pointer-events-none">
                <p className="text-[#fda4af] text-sm">暂停</p>
                <p className="text-[#fbcfe8]/90 text-[9px] text-center px-3">
                  空格继续
                </p>
              </div>
            )}
            {gameOver && (
              <div className="absolute inset-3 flex flex-col items-center justify-center gap-2 bg-[#2d1528]/92 px-3 py-4 overflow-y-auto max-h-full">
                <p className="text-[#fda4af] text-sm shrink-0">游戏结束</p>
                <p className="text-[#fbcfe8] text-[10px] shrink-0">
                  本局 {finalScore} 分 · {SPEED_LEVELS[speedIndex]?.label ?? ""}
                </p>
                {finalScore > 0 && (
                  <div className="flex flex-col gap-2 w-full max-w-[200px] shrink-0">
                    <input
                      type="text"
                      value={pendingName}
                      onChange={(e) =>
                        setPendingName(e.target.value.slice(0, 12))
                      }
                      placeholder="昵称（可空）"
                      disabled={rankSubmitted}
                      className="w-full px-2 py-1.5 text-[9px] bg-[#1a0d18] border-2 border-[#9d174d] text-[#fce7f3] placeholder:text-[#f472b6]/50 outline-none focus:border-[#f472b6]"
                    />
                    <button
                      type="button"
                      onClick={submitRank}
                      disabled={rankSubmitted}
                      className="px-3 py-2 text-[9px] bg-[#be185d] text-[#fdf2f8] border-2 border-[#fce7f3] shadow-[2px_2px_0_#831843] hover:bg-[#db2777] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {rankSubmitted ? "已记入排行榜" : "记入排行榜"}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={resetGame}
                  className="mt-1 px-4 py-2 text-[11px] bg-[#db2777] text-[#fdf2f8] border-2 border-[#fce7f3] shadow-[3px_3px_0_#831843] hover:bg-[#ec4899] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-colors shrink-0"
                >
                  再玩一次
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[#fbcfe8] text-[10px] sm:text-xs">
            <span>
              分数 <span className="text-[#ff69b4]">{score}</span>
            </span>
            <span>
              最高 <span className="text-[#f9a8d4]">{highScore}</span>
            </span>
            {started && !gameOver && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="px-3 py-1 border-2 border-[#be185d] text-[#fce7f3] bg-[#4c1d3d] hover:bg-[#5b2a4a] text-[9px]"
              >
                {paused ? "继续" : "暂停"}
              </button>
            )}
          </div>
        </div>

        <aside className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-3">
          <h2 className="text-[#fce7f3] text-xs tracking-widest border-b-2 border-[#be185d] pb-2">
            排行榜
          </h2>
          {leaderboard.length === 0 ? (
            <p className="text-[#f472b6]/70 text-[9px] leading-relaxed">
              暂无记录。游戏结束且得分大于 0 时，可输入昵称记入本机排行榜（仅当前浏览器）。
            </p>
          ) : (
            <div className="border-2 border-[#9d174d] bg-[#1a0d18]/80 overflow-hidden rounded-sm">
              <table className="w-full text-[8px] sm:text-[9px] text-left">
                <thead>
                  <tr className="bg-[#4c1d3d] text-[#fbcfe8]">
                    <th className="px-2 py-2 w-8 font-normal">#</th>
                    <th className="px-2 py-2 font-normal">昵称</th>
                    <th className="px-2 py-2 font-normal text-right">分</th>
                    <th className="px-2 py-2 font-normal hidden sm:table-cell">
                      速度
                    </th>
                    <th className="px-2 py-2 font-normal hidden sm:table-cell text-right">
                      时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, idx) => (
                    <tr
                      key={row.id}
                      className="border-t border-[#4a2444] text-[#f9a8d4]"
                    >
                      <td className="px-2 py-1.5 text-[#ff69b4]">{idx + 1}</td>
                      <td className="px-2 py-1.5 truncate max-w-[100px]">
                        {row.name}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[#fce7f3]">
                        {row.score}
                      </td>
                      <td className="px-2 py-1.5 hidden sm:table-cell text-[#f472b6]/90">
                        {row.speedLabel}
                      </td>
                      <td className="px-2 py-1.5 hidden sm:table-cell text-right text-[#f472b6]/70 whitespace-nowrap">
                        {new Date(row.at).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      </div>

      <Link
        href="/"
        className="text-[#f472b6]/70 hover:text-[#fbcfe8] text-[10px] transition-colors"
      >
        ← 返回首页
      </Link>
    </div>
  );
}
