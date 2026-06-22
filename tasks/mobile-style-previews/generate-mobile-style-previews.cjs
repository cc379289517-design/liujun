const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_DIR = __dirname;
const W = 430;
const H = 930;
const phoneX = 20;
const phoneY = 34;
const phoneW = 390;
const phoneH = 844;
const safeTop = phoneY + 24;
const contentX = phoneX + 16;
const contentW = phoneW - 32;

const colors = {
  bg: "#eef1f5",
  text: "#1e293b",
  secondary: "#64748b",
  muted: "#94a3b8",
  orange: "#f97316",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  card: "rgba(255,255,255,0.62)",
  cardStrong: "rgba(255,255,255,0.78)",
  line: "rgba(255,255,255,0.72)",
  shadow: "rgba(56,68,89,0.14)",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function t(x, y, text, size = 14, weight = 700, color = colors.text, extra = "") {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${esc(text)}</text>`;
}

function pill(x, y, w, h, fill, stroke = "rgba(255,255,255,0.78)", radius = h / 2) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" />`;
}

function card(x, y, w, h, radius = 20, strong = false) {
  return `
    <rect x="${x}" y="${y + 3}" width="${w}" height="${h}" rx="${radius}" fill="rgba(56,68,89,0.06)" />
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${strong ? colors.cardStrong : colors.card}" stroke="${colors.line}" />
    <path d="M ${x + 10} ${y + 1} H ${x + w - 18}" stroke="rgba(255,255,255,0.85)" stroke-width="1" />
  `;
}

function avatar(x, y, size, label = "马") {
  return `
    <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="url(#avatarGrad)" stroke="rgba(255,255,255,0.9)" stroke-width="3" />
    ${t(x + size / 2, y + size / 2 + 7, label, 21, 900, "#ffffff", 'text-anchor="middle"')}
    <circle cx="${x + size - 6}" cy="${y + size - 6}" r="7" fill="${colors.green}" stroke="#fff" stroke-width="3" />
  `;
}

function statusBar() {
  return `
    ${t(phoneX + 28, phoneY + 20, "9:41", 12, 800, colors.text)}
    <rect x="${phoneX + phoneW - 72}" y="${phoneY + 10}" width="18" height="10" rx="2" fill="none" stroke="${colors.text}" stroke-width="1.4" opacity="0.7" />
    <rect x="${phoneX + phoneW - 51}" y="${phoneY + 13}" width="3" height="4" rx="1" fill="${colors.text}" opacity="0.7" />
    <rect x="${phoneX + phoneW - 69}" y="${phoneY + 12}" width="12" height="6" rx="1" fill="${colors.green}" />
  `;
}

function topIdentity(roleText = "助理 · A区 401附近", alertText = null) {
  const y = safeTop + 24;
  return `
    ${card(contentX, y, contentW, 88, 22, true)}
    ${avatar(contentX + 14, y + 15, 58)}
    ${t(contentX + 86, y + 33, "马淑霞", 17, 900)}
    ${t(contentX + 86, y + 56, roleText, 12, 700, colors.secondary)}
    ${pill(contentX + contentW - 84, y + 22, 62, 30, "rgba(34,197,94,0.12)", "rgba(34,197,94,0.24)", 15)}
    <circle cx="${contentX + contentW - 69}" cy="${y + 37}" r="4" fill="${colors.green}" />
    ${t(contentX + contentW - 59, y + 42, "在线", 12, 900, colors.green)}
    ${alertText ? `
      ${pill(contentX, y + 102, contentW, 42, "rgba(249,115,22,0.11)", "rgba(249,115,22,0.28)", 16)}
      <circle cx="${contentX + 20}" cy="${y + 123}" r="5" fill="${colors.orange}" />
      ${t(contentX + 34, y + 128, alertText, 12, 900, colors.orange)}
    ` : ""}
  `;
}

function bottomNav(active = "current") {
  const y = phoneY + phoneH - 86;
  const items = [
    ["current", "当前", "M5 11h14v2H5z M8 5h8v6H8z"],
    ["map", "地图", "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"],
    ["queue", "队列", "M6 7h12 M6 12h12 M6 17h8"],
    ["me", "我的", "M12 12a4 4 0 100-8 4 4 0 000 8z M4 21a8 8 0 0116 0"],
  ];
  const gap = 8;
  const itemW = (contentW - gap * 3) / 4;
  return `
    ${card(contentX, y, contentW, 66, 22, true)}
    ${items.map(([key, label, icon], i) => {
      const x = contentX + i * (itemW + gap);
      const on = key === active;
      return `
        <g transform="translate(${x}, ${y + 9})">
          <rect width="${itemW}" height="48" rx="16" fill="${on ? "rgba(249,115,22,0.12)" : "transparent"}" />
          <path d="${icon}" transform="translate(${itemW / 2 - 10}, 6)" fill="none" stroke="${on ? colors.orange : colors.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          ${t(itemW / 2, 41, label, 10, 900, on ? colors.orange : colors.muted, 'text-anchor="middle"')}
        </g>
      `;
    }).join("")}
  `;
}

function phoneShell(inner, label, subtitle) {
  return `
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="pageGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f7f9fc" />
        <stop offset="62%" stop-color="#eef1f5" />
        <stop offset="100%" stop-color="#fff7ed" />
      </linearGradient>
      <linearGradient id="avatarGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fed7aa" />
        <stop offset="100%" stop-color="#fb923c" />
      </linearGradient>
      <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse">
        <path d="M 38 0 L 0 0 0 38" fill="none" stroke="rgba(67,82,104,0.055)" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="#f8fafc"/>
    ${t(W / 2, 22, label, 14, 900, colors.text, 'text-anchor="middle"')}
    ${t(W / 2, 902, subtitle, 11, 700, colors.secondary, 'text-anchor="middle"')}
    <rect x="${phoneX - 4}" y="${phoneY - 4}" width="${phoneW + 8}" height="${phoneH + 8}" rx="42" fill="rgba(15,23,42,0.12)" />
    <rect x="${phoneX}" y="${phoneY}" width="${phoneW}" height="${phoneH}" rx="38" fill="url(#pageGrad)" stroke="rgba(255,255,255,0.9)" />
    <rect x="${phoneX}" y="${phoneY}" width="${phoneW}" height="${phoneH}" rx="38" fill="url(#grid)" opacity="0.85" />
    <rect x="${phoneX + 138}" y="${phoneY + 9}" width="114" height="20" rx="10" fill="rgba(15,23,42,0.84)" />
    ${statusBar()}
    ${inner}
  </svg>`;
}

function assistantCurrent() {
  const y0 = safeTop + 24 + 88 + 58;
  const taskY = y0;
  const listY = taskY + 252;
  return phoneShell(`
    ${topIdentity("助理 · A区 401附近", "401 熨烫已就绪，请选择开始")}
    ${card(contentX, taskY, contentW, 224, 26, true)}
    ${pill(contentX + 18, taskY + 18, 82, 28, "rgba(59,130,246,0.12)", "rgba(59,130,246,0.25)", 14)}
    ${t(contentX + 33, taskY + 37, "待就位", 12, 900, colors.blue)}
    ${t(contentX + 18, taskY + 76, "401 熨烫", 30, 900, colors.text)}
    ${t(contentX + 19, taskY + 105, "摄影师：刘俊 · 预计 15 分钟", 13, 800, colors.secondary)}
    <rect x="${contentX + 18}" y="${taskY + 126}" width="${contentW - 36}" height="1" fill="rgba(148,163,184,0.22)" />
    ${t(contentX + 18, taskY + 154, "同楼层还有 2 个等待任务", 13, 800, colors.secondary)}
    ${pill(contentX + 18, taskY + 174, contentW - 36, 44, colors.orange, "rgba(249,115,22,0.0)", 14)}
    ${t(contentX + contentW / 2, taskY + 202, "开始熨烫", 15, 900, "#ffffff", 'text-anchor="middle"')}

    ${card(contentX, listY, contentW, 150, 20, false)}
    ${t(contentX + 18, listY + 31, "可开始任务", 15, 900)}
    ${pill(contentX + contentW - 70, listY + 15, 46, 24, "rgba(249,115,22,0.10)", "rgba(249,115,22,0.20)", 12)}
    ${t(contentX + contentW - 47, listY + 31, "2个", 11, 900, colors.orange, 'text-anchor="middle"')}
    ${miniTask(contentX + 18, listY + 50, "401 熨烫", "准备熨烫", colors.orange)}
    ${miniTask(contentX + 18, listY + 98, "427 手工DIY", "待开始", colors.blue)}
    ${bottomNav("current")}
  `, "C1 当前任务优先", "最适合助理日常：主按钮在拇指可触达区");
}

function miniTask(x, y, title, status, color) {
  return `
    <rect x="${x}" y="${y}" width="${contentW - 36}" height="38" rx="14" fill="rgba(255,255,255,0.54)" stroke="rgba(255,255,255,0.74)" />
    <circle cx="${x + 18}" cy="${y + 19}" r="5" fill="${color}" />
    ${t(x + 32, y + 24, title, 12, 900)}
    ${t(x + contentW - 72, y + 24, status, 11, 800, color, 'text-anchor="end"')}
  `;
}

function mapFirst() {
  const y0 = safeTop + 24 + 88 + 24;
  return phoneShell(`
    ${topIdentity("助理组长 · A区总览", null)}
    ${card(contentX, y0, contentW, 364, 28, true)}
    ${pill(contentX + 16, y0 + 16, 112, 30, "rgba(255,255,255,0.58)", "rgba(255,255,255,0.82)", 15)}
    <circle cx="${contentX + 34}" cy="${y0 + 31}" r="5" fill="${colors.blue}" />
    ${t(contentX + 48, y0 + 36, "区域平面图", 12, 900)}
    ${mapRoom(contentX + 28, y0 + 74, 116, 84, "401", colors.orange, "熨烫")}
    ${mapRoom(contentX + 158, y0 + 74, 156, 84, "402", colors.green, "空闲")}
    ${mapRoom(contentX + 28, y0 + 174, 136, 84, "427", colors.blue, "待就位")}
    ${mapRoom(contentX + 178, y0 + 174, 136, 84, "430", colors.red, "超时")}
    <path d="M${contentX + 48} ${y0 + 290} C ${contentX + 128} ${y0 + 250}, ${contentX + 210} ${y0 + 330}, ${contentX + 302} ${y0 + 282}" fill="none" stroke="rgba(249,115,22,0.55)" stroke-width="5" stroke-linecap="round" />
    ${t(contentX + 22, y0 + 336, "当前楼座：A区 · 4F", 13, 900)}
    ${t(contentX + contentW - 22, y0 + 336, "8人在线", 13, 900, colors.green, 'text-anchor="end"')}

    ${card(contentX, y0 + 386, contentW, 132, 22, false)}
    ${t(contentX + 18, y0 + 417, "地图下方保留当前任务抽屉", 14, 900)}
    ${miniTask(contentX + 18, y0 + 438, "马淑霞 · 401 熨烫", "待开始", colors.orange)}
    ${miniTask(contentX + 18, y0 + 486, "罗美琪 · 空闲", "可派发", colors.green)}
    ${bottomNav("map")}
  `, "C2 地图巡场优先", "保留桌面鸟瞰图气质，手机端用抽屉承接详情");
}

function mapRoom(x, y, w, h, room, color, label) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.82)" />
    <circle cx="${x + 22}" cy="${y + 24}" r="6" fill="${color}" />
    ${t(x + 40, y + 29, room, 15, 900)}
    ${t(x + 18, y + 58, label, 12, 900, color)}
  `;
}

function mixedRole() {
  const y0 = safeTop + 24 + 88 + 30;
  return phoneShell(`
    ${topIdentity("摄影师 · A区 405室", null)}
    ${card(contentX, y0, contentW, 136, 24, true)}
    ${t(contentX + 18, y0 + 34, "快捷发单", 17, 900)}
    ${t(contentX + 18, y0 + 58, "手机端保留摄影师完整流程", 12, 800, colors.secondary)}
    ${pill(contentX + 18, y0 + 78, 104, 40, "rgba(249,115,22,0.12)", "rgba(249,115,22,0.25)", 14)}
    ${t(contentX + 70, y0 + 103, "熨烫", 13, 900, colors.orange, 'text-anchor="middle"')}
    ${pill(contentX + 132, y0 + 78, 104, 40, "rgba(59,130,246,0.10)", "rgba(59,130,246,0.22)", 14)}
    ${t(contentX + 184, y0 + 103, "协作", 13, 900, colors.blue, 'text-anchor="middle"')}
    ${pill(contentX + 246, y0 + 78, 86, 40, "rgba(34,197,94,0.10)", "rgba(34,197,94,0.22)", 14)}
    ${t(contentX + 289, y0 + 103, "跟拍", 13, 900, colors.green, 'text-anchor="middle"')}

    ${card(contentX, y0 + 158, contentW, 178, 22, false)}
    ${t(contentX + 18, y0 + 190, "当前发布任务", 15, 900)}
    ${miniTask(contentX + 18, y0 + 210, "405 摄影协作", "执行中", colors.green)}
    ${miniTask(contentX + 18, y0 + 258, "401 熨烫", "队列中", colors.orange)}
    ${pill(contentX + 18, y0 + 310, contentW - 36, 38, "rgba(255,255,255,0.50)", "rgba(255,255,255,0.74)", 13)}
    ${t(contentX + contentW / 2, y0 + 334, "查看反馈与取消任务", 12, 900, colors.secondary, 'text-anchor="middle"')}

    ${card(contentX, y0 + 360, contentW, 128, 22, false)}
    ${t(contentX + 18, y0 + 392, "管理快速入口", 15, 900)}
    ${miniTask(contentX + 18, y0 + 412, "审批提醒", "3条", colors.red)}
    ${miniTask(contentX + 18, y0 + 460, "人员状态", "24人", colors.blue)}
    ${bottomNav("current")}
  `, "C3 综合身份入口", "摄影师与管理在手机上也能完成核心动作");
}

async function render(name, svg) {
  const out = path.join(OUT_DIR, `${name}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}

async function main() {
  const files = [
    await render("c1-current-task-desktop-style", assistantCurrent()),
    await render("c2-map-first-desktop-style", mapFirst()),
    await render("c3-mixed-role-desktop-style", mixedRole()),
  ];

  const thumbs = await Promise.all(files.map((file) => sharp(file).resize({ width: 300 }).toBuffer()));
  const contactW = 980;
  const contactH = 720;
  const baseSvg = `
    <svg width="${contactW}" height="${contactH}" viewBox="0 0 ${contactW} ${contactH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${contactW}" height="${contactH}" fill="#eef1f5"/>
      ${t(contactW / 2, 42, "C 方案修正版：贴近电脑端视觉风格", 24, 900, colors.text, 'text-anchor="middle"')}
      ${t(contactW / 2, 70, "同一套浅灰背景 / 玻璃面板 / 橙色主操作 / 蓝绿状态色，只调整手机端信息架构", 13, 800, colors.secondary, 'text-anchor="middle"')}
    </svg>
  `;
  await sharp(Buffer.from(baseSvg))
    .composite(thumbs.map((input, i) => ({ input, left: 34 + i * 315, top: 92 })))
    .png()
    .toFile(path.join(OUT_DIR, "c-style-comparison.png"));

  console.log(files.concat(path.join(OUT_DIR, "c-style-comparison.png")).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
