// 握不住 · Time Sand
// 改编自 mathfoxLab「sand animation」(OpenProcessing #2777877)
// 白底黑字：数字 1–9 像沙一样落下，落进看不见的表盘，被走动的指针扫落；
// 中央的标题 Durée 也是实体，数字会落在字上、卡在字缝里
//
// 交互：点一个表选中它（会稍微放大），然后按住任意一根指针拖动，
//       松手时甩出的速度就是这根指针之后的转速。点空白处或按 Esc 取消选中。
//
// 在 OpenProcessing 中使用：Mode 选 p5.js 即可。
// 物理引擎 matter.js 如果没有在 Libraries 里打开，代码会自动从 CDN 加载。

// ─────────── 可调参数 ───────────
const CONFIG = {
  MAX_DIGITS: 380,        // 画面中最多同时存在的数字（粒子）数量
  SPAWN_PER_FRAME: 2,     // 每帧最多新生成几个数字
  BIG_CHANCE: 0.07,       // 出现大号数字的概率
  SMALL_MIN: 0.014,       // 小号数字字号（× 画布边长）
  SMALL_MAX: 0.03,
  BIG_MIN: 0.05,          // 大号数字字号
  BIG_MAX: 0.085,
  CLOCK_R: 0.125,         // 表盘半径（× 画布短边）
  RING_OUTER: 0.86,       // 外圈 6 个表离画面中心的距离（× 半宽 / 半高）
  RING_INNER: 0.42,       // 内圈 3 个表离画面中心的距离
  INNER_ROTATE_DEG: 90,   // 内圈起始角度：90 = 一个在正上方、两个在左下和右下，
                          //   正好插在外圈两个表之间，互相不挡
  BOWL_OPEN_DEG: 120,     // 隐形表盘顶部的开口角度（数字从这里落进去）
  TIME_SCALE_MIN: 2,      // 每个表的走时倍速，随机取值范围
  TIME_SCALE_MAX: 30,     //   数值越大指针转得越快，越容易把数字甩出去
  // 隐形表盘的转速 = 三根指针当前转速的平均值，不再单独设定
  SHOW_BOWL: false,       // 调试用：true 时把隐形表盘画成浅灰线

  // ── 标题 ──
  TITLE: 'Durée',         // 开场标题：加载时出现，字形本身是物理障碍，数字会落在字上
  TITLE_SIZE: 0.1,        // 标题字号（× 画布短边）
  TITLE_MAX_W: 0.24,      // 标题最大宽度（× 画布宽），太宽会自动缩小
  TITLE_HOLD: 5,          // 按下按钮后标题再停留几秒，然后从下往上化成数字粒子
  BURST_ROW_MS: 60,       // 按钮和标题化开时每行的间隔，从字的底部往上
  BLURB_ROW_MS: 8,         // 开场说明自己的行间隔，整段不到一秒就化完
  BLURB_RISE_MS: 70,       // 说明粒子错开起飞；按钮仍是 0–320ms
  TITLE_WEIGHT: 600,
  TITLE_CELL: 24,         // 碰撞精度：字号 / 这个数 = 碰撞格子大小，越大越贴合字形

  // ── 交互 ──
  SELECT_SCALE: 1.15,     // 选中的表放大倍数
  MAX_HAND_SPEED: 3,      // 甩动指针后的最高转速（圈/秒），负数方向同样受限
  SPEED_RECOVER_SEC: 0,   // >0 时，松手后指针会在约这么多秒内慢慢回到原本的速度
                          //   （「人无法改变时间」）；0 = 保持你甩出的速度
  INK: '#111111',         // 黑色
  ACCENT: '#d62b1f',      // 秒针与中心点的红色
  BG: '#ffffff',          // 白底
  FONT: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  WEIGHT: 500,
};

var Engine, Bodies, Body, Composite, Events;
var TAU_ = Math.PI * 2;

var S, W, H, engine, clocks = [], digits = [];
var accumulator = 0;
var STEP = 1000 / 60;
var ready = false;
var titleReady = false;
var simStarted = false;
var title = null;                    // { text, x, y, size, font }
var selected = null;                 // 当前选中的表
var drag = null;                     // { clock, hand, lastPhi, lastT, vel }
var rises = [];                      // 按钮 / 标题化开后、从下往上飞出的数字
var pendingRise = [];                // 错开起飞，避免一整排同时升起来

var bootStarted = false;

function setup() {
  W = windowWidth; H = windowHeight;
  S = Math.min(W, H);                         // 短边，用来换算字号和表盘大小
  const cnv = createCanvas(W, H);
  if (document.getElementById('stage')) cnv.parent('stage');
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  startPiece();                               // 先只放标题，和进场后是同一个
}

function startPiece() {
  if (bootStarted) return;
  bootStarted = true;
  // 确保 matter.js 已加载；没有就自动从 CDN 加载
  if (typeof Matter !== 'undefined') {
    initPhysics();
  } else {
    const tag = document.createElement('script');
    tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
    tag.onload = initPhysics;
    tag.onerror = () => console.error('matter.js 加载失败：请在 OpenProcessing 右侧 Libraries 里打开 matter.js');
    document.head.appendChild(tag);
  }
}

function initPhysics() {
  ({ Engine, Bodies, Body, Composite, Events } = Matter);
  engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  Events.on(engine, 'collisionStart', onCollisionStart);

  // 等字体加载完再生成标题的碰撞形状，保证物理边界和画出来的字形一致。
  // 表盘和数字要等按下 Enter 才开始。
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    buildTitle();
    titleReady = true;
    placePrompt();
  };
  if (document.fonts && document.fonts.load) {
    document.fonts.load(`${CONFIG.TITLE_WEIGHT} 100px ${CONFIG.FONT}`)
      .then(() => document.fonts.ready).then(go, go);
    setTimeout(go, 2000);                   // 字体迟迟不来也照常开始
  } else go();
}

// ─────────── 标题 Durée ───────────
// 把标题画到一张离屏画布上，按像素扫描出字形，
// 合并成一组静态矩形作为碰撞体：数字能落在 D 的顶上、卡进 u 的凹槽里。
function buildTitle(born) {
  const text = CONFIG.TITLE;
  if (!text) { title = null; return; }
  const fam = CONFIG.FONT;
  const font = (px) => `${CONFIG.TITLE_WEIGHT} ${px}px ${fam}`;

  const probe = document.createElement('canvas').getContext('2d');
  let size = CONFIG.TITLE_SIZE * S;
  probe.font = font(size);
  const wAtSize = probe.measureText(text).width;
  size = Math.min(size, size * (CONFIG.TITLE_MAX_W * W) / wAtSize);
  probe.font = font(size);
  const m = probe.measureText(text);
  const left = m.actualBoundingBoxLeft || 0;
  const asc = m.actualBoundingBoxAscent || size * 0.75;
  const desc = m.actualBoundingBoxDescent || 0;
  const tw = Math.ceil(left + m.actualBoundingBoxRight || m.width);
  const th = Math.ceil(asc + desc);

  // 标题在画布上的位置：文字外框居中
  const x0 = W / 2 - tw / 2;               // 外框左上角
  const y0 = H / 2 - th / 2;

  // 离屏光栅化
  const pad = 2;
  const off = document.createElement('canvas');
  off.width = tw + pad * 2; off.height = th + pad * 2;
  const g = off.getContext('2d');
  g.font = font(size);
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.fillText(text, pad + left, pad + asc);
  const data = g.getImageData(0, 0, off.width, off.height).data;
  const filled = (px, py) => {
    px = Math.round(px); py = Math.round(py);
    if (px < 0 || py < 0 || px >= off.width || py >= off.height) return false;
    return data[(py * off.width + px) * 4 + 3] > 110;
  };

  // 网格扫描 → 每行合并成横条 → 上下相同的横条再合并
  const cell = Math.max(3, size / CONFIG.TITLE_CELL);
  const cols = Math.ceil(off.width / cell), rows = Math.ceil(off.height / cell);
  let open = new Map();                    // key "c0-c1" → rect
  const rects = [];
  for (let r = 0; r < rows; r++) {
    const runs = [];
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && filled((c + 0.5) * cell, (r + 0.5) * cell);
      if (on && start < 0) start = c;
      if (!on && start >= 0) { runs.push([start, c]); start = -1; }
    }
    const next = new Map();
    for (const [c0, c1] of runs) {
      const key = c0 + '-' + c1;
      const rect = open.get(key);
      if (rect) { rect.r1 = r + 1; next.set(key, rect); open.delete(key); }
      else { const nr = { c0, c1, r0: r, r1: r + 1 }; rects.push(nr); next.set(key, nr); }
    }
    open = next;
  }

  const bodies = rects.map(q => {
    const w = (q.c1 - q.c0) * cell, h = (q.r1 - q.r0) * cell;
    const cx = x0 - pad + q.c0 * cell + w / 2;
    const cy = y0 - pad + q.r0 * cell + h / 2;
    return Bodies.rectangle(cx, cy, w, h, {
      isStatic: true, friction: 0.4, label: 'title',
      collisionFilter: { category: 0x0002 },   // 化开的数字会穿过标题往上飞
    });
  });
  Composite.add(engine.world, bodies);

  const particleSize = Math.max(8, CONFIG.SMALL_MIN * S * 1.15);
  const step = Math.max(4, particleSize * 0.55);
  const glyphRows = [];
  for (let py = off.height - 1; py >= 0; py -= step) {
    const pts = [];
    for (let px = 0; px < off.width; px += step) {
      if (filled(px, py)) pts.push({ x: x0 - pad + px, y: y0 - pad + py });
    }
    if (pts.length) glyphRows.push({ y: y0 - pad + py, pts });
  }

  // born 为 null：还停在入口，标题不开始计时。传入 born（含 null）则保持原计时。
  const start = arguments.length ? born : (window.__dureeEntered ? millis() : null);
  title = { text, size, font: font(size), x: x0 + left, y: y0 + asc, bottom: y0 + th, bodies,
            born: start, solid: true, rows: glyphRows, cursor: 0, particleSize, burst: false };
  placePrompt();
}

function startTitleBurst() {
  if (!title || title.burst) return;
  title.burst = true;
  title.cursor = 0;
  if (title.solid) {
    Composite.remove(engine.world, title.bodies);
    title.solid = false;
  }
  rises.push({ rows: title.rows, cursor: 0, particleSize: title.particleSize, next: 0, host: title });
}

function placePrompt() {
  const el = document.getElementById('gate');
  if (!el || !title) return;
  el.style.top = (title.bottom + 22) + 'px';
  fitBlurb();
}

// 说明在按钮下方。底部不够时缩小字号，避免裁出画面，也不盖住标题。
function fitBlurb() {
  const blurb = document.getElementById('blurb');
  if (!blurb) return;
  blurb.style.fontSize = '';
  const limit = window.innerHeight - 18;
  for (let n = 0; n < 14; n++) {
    if (blurb.getBoundingClientRect().bottom <= limit) return;
    const px = parseFloat(getComputedStyle(blurb).fontSize);
    if (px <= 11) return;
    blurb.style.fontSize = (Math.round((px - 0.5) * 10) / 10) + 'px';
  }
}

function beginSim() {
  if (simStarted || !titleReady) return;
  simStarted = true;
  if (title && title.born == null) title.born = millis();
  if (clocks.length === 0) buildClocks();
  ready = true;
}

function updateTitle() {
  if (!title || title.burst) return;
  if (title.born == null) return;
  if ((millis() - title.born) / 1000 >= CONFIG.TITLE_HOLD) startTitleBurst();
}

function drawTitle() {
  if (!title) return;
  const ctx = drawingContext;
  ctx.save();
  ctx.fillStyle = CONFIG.INK;
  ctx.font = title.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (title.burst && title.cursor > 0) {
    const prev = title.rows[title.cursor - 1];
    if (!prev) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.rect(0, 0, W, prev.y);
    ctx.clip();
  }
  ctx.fillText(title.text, title.x, title.y);
  ctx.restore();
}

// 加载中（物理引擎、字体还没就绪）时先把标题居中显示出来
function drawLoadingTitle() {
  if (!CONFIG.TITLE) return;
  const ctx = drawingContext;
  const size = Math.min(CONFIG.TITLE_SIZE * S, CONFIG.TITLE_MAX_W * W / 2.6);
  ctx.save();
  ctx.fillStyle = CONFIG.INK;
  ctx.font = `${CONFIG.TITLE_WEIGHT} ${size}px ${CONFIG.FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(CONFIG.TITLE, W / 2, H / 2);
  ctx.restore();
}

// ─────────── 表盘 ───────────
// 位置沿用原作：外圈 6 个、内圈 3 个。表盘固定不动、不可见，
// 只保留一个开口朝上的「碗」作为物理边界；指针是会推动数字的刚体。
const HANDS = [
  // period 一圈的秒数；len/tail 相对半径；w 线宽相对半径
  { name: 'hour',   period: 43200, len: 0.55, tail: 0.12, w: 0.09,  accent: false },
  { name: 'minute', period: 3600,  len: 0.82, tail: 0.14, w: 0.06,  accent: false },
  { name: 'second', period: 60,    len: 0.9,  tail: 0.22, w: 0.022, accent: true  },
];

function buildClocks() {
  const layout = [];
  for (let i = 0; i < 6; i++) {
    const a = TAU_ * i / 6;
    layout.push({ x: CONFIG.RING_OUTER * Math.cos(a), y: CONFIG.RING_OUTER * Math.sin(a) });
  }
  for (let i = 0; i < 3; i++) {
    const a = radians(CONFIG.INNER_ROTATE_DEG) + TAU_ * i / 3;
    layout.push({ x: CONFIG.RING_INNER * Math.cos(a), y: CONFIG.RING_INNER * Math.sin(a) });
  }

  const R = CONFIG.CLOCK_R * S;
  const openHalf = radians(CONFIG.BOWL_OPEN_DEG) / 2;
  const span = TAU_ - 2 * openHalf;
  const T = Math.max(6, R * 0.1);
  const n = 32;

  for (const L of layout) {
    const cx = (L.x + 1) * 0.5 * W;
    const cy = (-L.y + 1) * 0.5 * H;

    // 隐形的碗：开口朝正上方（画布角度 -90°）
    const top = -Math.PI / 2;
    const parts = [];
    for (let k = 0; k < n; k++) {
      const phi = top + openHalf + span * (k + 0.5) / n;
      parts.push(Bodies.rectangle(
        cx + R * Math.cos(phi), cy + R * Math.sin(phi),
        R * span / n * 1.25, T, { angle: phi + Math.PI / 2, label: 'bowl' }
      ));
    }
    const bowl = Body.create({ parts, isStatic: true, friction: 0.5, label: 'bowl' });
    Composite.add(engine.world, bowl);

    const t0 = random(0, 43200);                       // 随机时间
    const scale = random(CONFIG.TIME_SCALE_MIN, CONFIG.TIME_SCALE_MAX);
    const hands = HANDS.map(h => {
      const ang = handAngle(t0, h.period);
      const natural = TAU_ / h.period * scale;         // 原本的转速（弧度/秒）
      const len = h.len * R, tail = h.tail * R;
      const thick = Math.max(4, h.w * R);
      const mid = (len - tail) / 2;
      const body = Bodies.rectangle(
        cx + mid * Math.cos(ang), cy + mid * Math.sin(ang),
        len + tail, thick,
        { isStatic: true, angle: ang, friction: 0.3, label: 'hand' }
      );
      Composite.add(engine.world, body);
      // a = 指针相对表盘的角度；ang = 画布上的实际角度
      return { ...h, body, a: ang, ang, speed: natural, natural, lenPx: len, tailPx: tail, thick };
    });

    clocks.push({ cx, cy, R, top, openHalf, bowl, hands, rot: 0, k: 1 });
  }
}

function handAngle(t, period) {
  return -Math.PI / 2 + ((t % period) / period) * TAU_;
}

function wrapPI(x) {
  x = (x + Math.PI) % TAU_;
  if (x < 0) x += TAU_;
  return x - Math.PI;
}

// ─────────── 数字粒子 ───────────
function spawnDigit() {
  const big = random() < CONFIG.BIG_CHANCE;
  const size = (big ? random(CONFIG.BIG_MIN, CONFIG.BIG_MAX)
                    : random(CONFIG.SMALL_MIN, CONFIG.SMALL_MAX)) * S;
  const d = String(Math.floor(random(1, 10)));

  drawingContext.font = `${CONFIG.WEIGHT} ${size}px ${CONFIG.FONT}`;
  const w = Math.max(drawingContext.measureText(d).width, size * 0.35);
  const h = size * 0.72;                       // 数字的大写高度

  const body = Bodies.rectangle(
    random(W), -h - random(H * 0.1), w, h,
    { friction: 0.35, frictionStatic: 0.6, restitution: 0.05, label: 'digit',
      angle: random(-0.4, 0.4), chamfer: { radius: Math.min(w, h) * 0.12 } }
  );
  Body.setVelocity(body, { x: random(-0.6, 0.6), y: 0 });
  Composite.add(engine.world, body);
  digits.push({ body, d, size });
}

// 按钮、说明或标题化开：小数字从下往上飞出。
// 按钮和说明一旦下落就改用和 spawnDigit 一样的空气阻力，不再限速。
function spawnRisingDigit(x, y, size, fromButton, sizeJitter, sandFall) {
  const d = String(Math.floor(random(1, 10)));
  const lo = sizeJitter ? sizeJitter[0] : 0.72;
  const hi = sizeJitter ? sizeJitter[1] : 1.28;
  const s = size * random(lo, hi);
  const w = Math.max(s * 0.48, 4);
  const h = s * 0.72;
  const body = Bodies.rectangle(
    x + random(-2, 2), y + random(-1, 2), w, h,
    { friction: 0.25, frictionStatic: 0.2, restitution: 0.12, label: 'digit',
      // 按钮和说明在上升时仍用原来的阻力，转下落后再改成 0.01。
      frictionAir: (sandFall || fromButton) ? 0.11 : 0.02,
      angle: random(-0.8, 0.8),
      chamfer: { radius: Math.min(w, h) * 0.12 },
      collisionFilter: { category: 0x0004, mask: 0x0001 | 0x0004 } }
  );
  // 升力拉开差距：有的只抬一下，有的冲得更高，左右也散开
  const weak = random() < 0.34;
  const lift = (fromButton || sandFall)
    ? (weak ? random(-5, -1.6) : random(-13, -5))
    : (weak ? random(-7, -2) : random(-16, -6));
  Body.setVelocity(body, { x: random(-6, 6), y: lift });
  Body.setAngularVelocity(body, random(-0.15, 0.15));
  Composite.add(engine.world, body);
  digits.push({
    body, d, size: s,
    fromButton: !!fromButton && !sandFall,
    sandFall: !!sandFall,
  });
}

function releasePoint(p, size, fromButton, riseDelay, sizeJitter, sandFall) {
  const spread = riseDelay != null ? riseDelay : (fromButton ? 320 : 180);
  pendingRise.push({
    x: p.x, y: p.y, size, fromButton, sizeJitter, sandFall: !!sandFall,
    at: millis() + (spread > 0 ? random(0, spread) : 0),
  });
}

function flushPendingRise() {
  if (!engine) return;
  const now = millis();
  for (let i = pendingRise.length - 1; i >= 0; i--) {
    const p = pendingRise[i];
    if (now < p.at) continue;
    spawnRisingDigit(p.x, p.y, p.size, p.fromButton, p.sizeJitter, p.sandFall);
    pendingRise.splice(i, 1);
  }
}

// 按钮化开的数字：可以先从下往上飞，升出画面就从上方落回。
// 一旦下落，空气阻力和重力与 spawnDigit 相同，穿过标题后撞上表盘。
function settleButtonDigits() {
  for (const g of digits) {
    if (!g.fromButton) continue;
    const b = g.body;
    if (b.position.y < -30) {
      const x = Math.min(W - 30, Math.max(30, b.position.x + random(-80, 80)));
      Body.setPosition(b, { x, y: random(12, 64) });
      Body.setVelocity(b, { x: random(-2.4, 2.4), y: random(1.1, 2.6) });
    }
    // 下落起改成和普通沙粒一样的空气阻力（Matter 默认 0.01），不再限速。
    if (b.velocity.y > 0) b.frictionAir = 0.01;
    // 不和标题碰撞（0x0002），否则会停在 Durée 上，进不了表盘
    if (!g.falling && b.velocity.y > 0.25) {
      g.falling = true;
      b.collisionFilter.category = 0x0001;
      b.collisionFilter.mask = 0x0001 | 0x0004;
    }
  }
}

// 说明粒子：上升保持原样；velocity.y > 0 之后空气阻力改成
// 和 spawnDigit 相同（不设 frictionAir 时 Matter 默认 0.01），重力也不再被限速吃掉。
function releaseBlurbFall() {
  for (const g of digits) {
    if (!g.sandFall || g.falling) continue;
    const b = g.body;
    if (b.velocity.y > 0) {
      g.falling = true;
      b.frictionAir = 0.01;
    }
  }
}

function textRows(text, font, box, step) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const m = probe.measureText(text);
  const left = m.actualBoundingBoxLeft || 0;
  const asc = m.actualBoundingBoxAscent || 12;
  const desc = m.actualBoundingBoxDescent || 3;
  const tw = Math.ceil(left + (m.actualBoundingBoxRight || m.width));
  const th = Math.ceil(asc + desc);
  const pad = 2;
  const off = document.createElement('canvas');
  off.width = Math.max(1, tw + pad * 2);
  off.height = Math.max(1, th + pad * 2);
  const g = off.getContext('2d', { willReadFrequently: true });
  g.font = font;
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.fillText(text, pad + left, pad + asc);
  const data = g.getImageData(0, 0, off.width, off.height).data;
  const ox = box.x + box.w / 2 - tw / 2;
  const oy = box.y + box.h / 2 - th / 2;
  const rows = [];
  // 步长必须是整数，否则读到的不是 alpha，字形会被当成空白
  const stride = Math.max(1, Math.round(step));
  for (let py = off.height - 1; py >= 0; py -= stride) {
    const pts = [];
    for (let px = 0; px < off.width; px += stride) {
      if (data[(py * off.width + px) * 4 + 3] > 110) pts.push({ x: ox + px - pad, y: oy + py - pad });
    }
    if (pts.length) rows.push({ y: oy + py - pad, pts });
  }
  return {
    rows,
    label: { text, font, x: ox + left, y: oy + asc },
  };
}

function limitRisePoints(rows, cap) {
  let total = 0;
  for (const row of rows) total += row.pts.length;
  if (total <= cap || !total) return;
  const stride = total / cap;
  let acc = 0;
  for (const row of rows) {
    const kept = [];
    for (const p of row.pts) {
      acc += 1;
      if (acc >= stride) {
        kept.push(p);
        acc -= stride;
      }
    }
    row.pts = kept;
  }
}

// 按浏览器实际换行取出每一行，供光栅和化开时的重绘使用。
function visualLines(el, font) {
  el.normalize();
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  if (!node) return [];
  const text = node.textContent;
  const range = document.createRange();
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const sample = probe.measureText('MgÉ');
  const asc0 = sample.actualBoundingBoxAscent || 10;
  const desc0 = sample.actualBoundingBoxDescent || 3;
  const spans = [];
  let start = 0;
  let prevLeft = null;
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rects = range.getClientRects();
    if (!rects.length) continue;
    const rect = rects[0];
    if (prevLeft != null && rect.left + 0.5 < prevLeft) {
      spans.push([start, i]);
      start = i;
    }
    prevLeft = rect.left;
  }
  spans.push([start, text.length]);

  const lines = [];
  for (const [a0, b0] of spans) {
    let a = a0, b = b0;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (a >= b) continue;
    range.setStart(node, a);
    range.setEnd(node, b);
    const box = range.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const slice = text.slice(a, b);
    const m = probe.measureText(slice);
    const asc = m.actualBoundingBoxAscent || asc0;
    const desc = m.actualBoundingBoxDescent || desc0;
    const glyphH = asc + desc;
    const baseline = box.height <= glyphH * 1.25
      ? box.bottom - desc
      : box.top + (box.height - glyphH) / 2 + asc;
    lines.push({ text: slice, x: box.left + (m.actualBoundingBoxLeft || 0), y: baseline });
  }
  return lines;
}

// 开场说明：按下时就从下往上化开，不等标题的 5 秒停留。
// 上升之后按普通沙粒下落。
function burstBlock(el) {
  if (!el || !el.isConnected) return;
  const cs = getComputedStyle(el);
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const fontPx = parseFloat(cs.fontSize) || 13;
  const host = el.getBoundingClientRect();
  if (host.width < 2 || host.height < 2) return;
  const lines = visualLines(el, font);
  if (!lines.length) return;

  const pad = 6;
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(host.width) + pad * 2);
  off.height = Math.max(1, Math.ceil(host.height) + pad * 2);
  const g = off.getContext('2d', { willReadFrequently: true });
  g.font = font;
  g.fillStyle = '#000';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const drawLines = [];
  for (const line of lines) {
    g.fillText(line.text, line.x - host.left + pad, line.y - host.top + pad);
    drawLines.push({ text: line.text, font, x: line.x, y: line.y });
  }
  const data = g.getImageData(0, 0, off.width, off.height).data;
  const step = Math.max(3, Math.round(fontPx * 0.22));
  const rows = [];
  for (let py = off.height - 1; py >= 0; py -= step) {
    const pts = [];
    const y = host.top - pad + py;
    for (let px = 0; px < off.width; px += step) {
      if (data[(py * off.width + px) * 4 + 3] > 110) {
        pts.push({ x: host.left - pad + px, y });
      }
    }
    if (pts.length) rows.push({ y, pts });
  }
  if (!rows.length) return;
  // 和按钮 / 标题同一量级，避免整段逐像素生成上万个刚体
  limitRisePoints(rows, 240);
  rises.push({
    rows, cursor: 0, lines: drawLines,
    particleSize: Math.min(10, Math.max(8, S * 0.007)),
    sizeJitter: [0.65, 1.22],
    next: 0, host: null, sandFall: true,
    rowMs: CONFIG.BLURB_ROW_MS,
    riseDelay: CONFIG.BLURB_RISE_MS,
  });
}

function burstButton(btn) {
  if (!btn) return;
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const fontPx = parseFloat(cs.fontSize) || 15;
  const step = Math.max(2.5, fontPx * 0.22);
  const raster = textRows(btn.textContent.trim(), cs.font, { x: r.left, y: r.top, w: r.width, h: r.height }, step);
  rises.push({
    rows: raster.rows, cursor: 0, label: raster.label,
    particleSize: Math.max(16, S * 0.028), next: 0, host: null, fromButton: true,
  });
}

function drawRiseLabels() {
  const ctx = drawingContext;
  for (const item of rises) {
    const lines = item.lines || (item.label ? [item.label] : null);
    if (!lines) continue;
    ctx.save();
    ctx.fillStyle = CONFIG.INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (item.cursor > 0) {
      const prev = item.rows[item.cursor - 1];
      if (prev) {
        ctx.beginPath();
        ctx.rect(0, 0, W, prev.y);
        ctx.clip();
      }
    }
    for (const line of lines) {
      ctx.font = line.font;
      ctx.fillText(line.text, line.x, line.y);
    }
    ctx.restore();
  }
}

function updateRises() {
  if (!engine) return;
  const now = millis();
  for (let i = rises.length - 1; i >= 0; i--) {
    const item = rises[i];
    const fast = item.rowMs != null;
    // 说明一帧可以化开多行；按钮和标题仍每到点只走一行
    if (fast) {
      if (item.riseFrame === frameCount) continue;
      item.riseFrame = frameCount;
    } else if (now < item.next) continue;
    if (item.cursor >= item.rows.length) { rises.splice(i, 1); continue; }
    const rowMs = fast ? item.rowMs : CONFIG.BURST_ROW_MS;
    let quota = 1;
    if (fast) {
      const frame = Math.min(32, Math.max(rowMs, (typeof deltaTime === 'number' && deltaTime > 0) ? deltaTime : 16));
      item.rowDebt = (item.rowDebt || 0) + frame;
      quota = Math.floor(item.rowDebt / rowMs);
      if (quota < 1) quota = 1;
      item.rowDebt -= quota * rowMs;
    }
    let finished = false;
    for (let n = 0; n < quota; n++) {
      if (item.cursor >= item.rows.length) { finished = true; break; }
      const row = item.rows[item.cursor++];
      if (item.host) item.host.cursor = item.cursor;
      for (const p of row.pts) releasePoint(p, item.particleSize, !!item.fromButton, item.riseDelay, item.sizeJitter, !!item.sandFall);
      if (item.cursor >= item.rows.length) finished = true;
      if (finished) break;
    }
    if (finished) {
      if (item.host && title === item.host) title = null;
      rises.splice(i, 1);
    } else if (!fast) {
      item.next = now + rowMs;
    }
  }
}

// ─────────── 主循环 ───────────
function draw() {
  if (!bootStarted) startPiece();
  background(CONFIG.BG);
  if (window.__dureeEntered) beginSim();
  updateRises();
  flushPendingRise();
  if (!simStarted) { drawTitle(); drawRiseLabels(); drawDigits(); return; }
  updateTitle();
  updateRises();
  flushPendingRise();
  // 生成
  for (let i = 0; i < CONFIG.SPAWN_PER_FRAME && digits.length < CONFIG.MAX_DIGITS; i++) {
    spawnDigit();
  }

  updateDrag();

  // 物理（固定步长）
  accumulator += Math.min(deltaTime, 50);
  while (accumulator >= STEP) {
    const dt = STEP / 1000;
    for (const c of clocks) {
      const center = { x: c.cx, y: c.cy };
      // 选中的表平滑放大，物理边界一起放大
      const kTarget = c === selected ? CONFIG.SELECT_SCALE : 1;
      const kNew = c.k + (kTarget - c.k) * 0.15;
      if (Math.abs(kNew - c.k) > 1e-4) {
        const ratio = kNew / c.k;
        Body.scale(c.bowl, ratio, ratio, center);
        for (const h of c.hands) Body.scale(h.body, ratio, ratio, center);
        c.k = kNew;
      }
      // 先更新指针转速，隐形表盘再按三根指针转速的平均值转动
      let speedSum = 0;
      for (const h of c.hands) {
        const held = drag && drag.hand === h;
        if (!held && CONFIG.SPEED_RECOVER_SEC > 0) {
          h.speed += (h.natural - h.speed) * Math.min(1, dt / CONFIG.SPEED_RECOVER_SEC);
        }
        speedSum += held ? drag.vel : h.speed;
      }
      const dRot = speedSum / c.hands.length * dt;
      Body.rotate(c.bowl, dRot, center, true);
      c.rot = (c.rot + dRot) % TAU_;
      if (c.rot < 0) c.rot += TAU_;
      for (const h of c.hands) {
        const held = drag && drag.hand === h;
        if (!held) h.a += h.speed * dt;
        // 实际角度 = 指针自身角度 + 表盘转过的角度（12 点跟着表盘一起转）
        const target = h.a + c.rot;
        const d = wrapPI(target - h.ang);           // 取最短方向
        // 第 4 个参数让指针带上速度，被扫到的数字会被真正「推」出去
        Body.rotate(h.body, d, center, true);
        h.ang = h.ang + d;
      }
    }
    try { updateClockTicks(dt); } catch (err) {}
    releaseBlurbFall();
    Engine.update(engine, STEP);
    accumulator -= STEP;
  }

  settleButtonDigits();

  // 左右循环、落出底部则回收
  for (let i = digits.length - 1; i >= 0; i--) {
    const b = digits[i].body;
    if (b.position.y > H + 120) {
      Composite.remove(engine.world, b);
      digits.splice(i, 1);
      continue;
    }
    if (b.position.x < -40) Body.setPosition(b, { x: b.position.x + W + 80, y: b.position.y });
    else if (b.position.x > W + 40) Body.setPosition(b, { x: b.position.x - W - 80, y: b.position.y });
  }

  // 绘制。化开中的按钮 / 说明画在指针上面，字还在时不被表盖住。
  background(CONFIG.BG);
  drawTitle();
  drawDigits();
  for (const c of clocks) if (c !== selected) drawClock(c);   // 指针画在数字上面
  if (selected) drawClock(selected);                            // 选中的表画在最上层
  drawRiseLabels();
  updateCursor();
}

function drawDigits() {
  const ctx = drawingContext;
  ctx.fillStyle = CONFIG.INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const g of digits) {
    const b = g.body;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.font = `${CONFIG.WEIGHT} ${g.size}px ${CONFIG.FONT}`;
    ctx.fillText(g.d, 0, g.size * 0.36);
    ctx.restore();
  }
}

function drawClock(c) {
  const { cx, cy, k } = c;
  const R = c.R * k;
  const active = drag ? drag.hand : (c === selected ? pickHand(c, mouseX, mouseY) : null);
  push();
  if (CONFIG.SHOW_BOWL) {
    noFill(); stroke(200); strokeWeight(1);
    arc(cx, cy, 2 * R, 2 * R, c.top + c.rot + c.openHalf, c.top + c.rot + TAU_ - c.openHalf);
  }
  strokeCap(SQUARE);
  for (const h of c.hands) {
    const w = h.w * R * (h === active ? 1.6 : 1);    // 鼠标指着 / 正在拖的指针加粗
    hand(cx, cy, h.ang, h.lenPx * k, w, h.accent ? CONFIG.ACCENT : CONFIG.INK, h.tailPx * k);
  }
  noStroke();
  fill(CONFIG.ACCENT);
  circle(cx, cy, R * 0.14);
  pop();
}

function hand(cx, cy, ang, len, w, col, tail) {
  stroke(col);
  strokeWeight(w);
  line(cx - tail * Math.cos(ang), cy - tail * Math.sin(ang),
       cx + len * Math.cos(ang), cy + len * Math.sin(ang));
}

// 窗口大小变化时，按新的全屏尺寸重建
function windowResized() {
  if (!titleReady || !engine) return;
  W = windowWidth; H = windowHeight; S = Math.min(W, H);
  resizeCanvas(W, H);
  Composite.clear(engine.world, false);
  clocks = []; digits = []; rises = []; pendingRise = [];
  selected = null; drag = null;
  pairHitAt.clear();
  bodyHitAt.clear();
  const born = title ? title.born : null;
  const keepTitle = title && title.solid;
  title = null;
  if (simStarted) buildClocks();
  if (keepTitle) buildTitle(born);          // 同一个标题，位置随新尺寸重算，计时不变
  else title = null;
  placePrompt();
}

// ─────────── 交互 ───────────
function clockAt(x, y) {
  // 选中的表优先（它画在最上层）
  const order = selected ? [selected, ...clocks.filter(c => c !== selected)] : clocks;
  for (const c of order) {
    if (Math.hypot(x - c.cx, y - c.cy) <= c.R * c.k) return c;
  }
  return null;
}

// 找离鼠标最近的指针：按鼠标到指针线段的距离判断
function pickHand(c, x, y) {
  const dx = x - c.cx, dy = y - c.cy;
  const dist = Math.hypot(dx, dy);
  if (dist > c.R * c.k * 1.05) return null;
  let best = null, bestD = Infinity;
  for (const h of c.hands) {
    const along = dx * Math.cos(h.ang) + dy * Math.sin(h.ang);
    const across = Math.abs(-dx * Math.sin(h.ang) + dy * Math.cos(h.ang));
    const len = h.lenPx * c.k, tail = h.tailPx * c.k;
    const clamped = Math.max(-tail, Math.min(len, along));
    const d = Math.hypot(along - clamped, across);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

function mousePressed() {
  if (!ready) return;
  const c = clockAt(mouseX, mouseY);
  if (!c) { selected = null; return; }       // 点空白处：取消选中
  selected = c;
  const h = pickHand(c, mouseX, mouseY);
  if (h) {
    drag = {
      clock: c, hand: h,
      lastPhi: Math.atan2(mouseY - c.cy, mouseX - c.cx),
      lastT: millis(), vel: 0,
    };
  }
  return false;
}

function updateDrag() {
  if (!drag) return;
  const c = drag.clock, h = drag.hand;
  const phi = Math.atan2(mouseY - c.cy, mouseX - c.cx);
  const now = millis();
  const dtS = Math.max(1, now - drag.lastT) / 1000;
  const dPhi = wrapPI(phi - drag.lastPhi);
  // 记录拖动的角速度（平滑一下，松手时用它作为新转速）
  drag.vel += (dPhi / dtS - drag.vel) * 0.35;
  drag.lastPhi = phi; drag.lastT = now;
  h.a += dPhi;                                // 指针跟着鼠标转
}

function mouseReleased() {
  if (!drag) return;
  const h = drag.hand;
  const max = TAU_ * CONFIG.MAX_HAND_SPEED;
  // 松手前已经停住不动，就立刻回到原本的转速；甩出去的速度仍然保持
  if (Math.abs(drag.vel) < 0.15) h.speed = h.natural;
  else h.speed = Math.max(-max, Math.min(max, drag.vel));
  drag = null;
  return false;
}

function updateCursor() {
  let cur = 'default';
  if (drag) cur = 'grabbing';
  else if (selected && clockAt(mouseX, mouseY) === selected && pickHand(selected, mouseX, mouseY)) cur = 'grab';
  else if (clockAt(mouseX, mouseY)) cur = 'pointer';
  cursor(cur);
}

// 按 R 清空所有数字；按 Esc 取消选中
function keyPressed() {
  if (!ready) return;
  if (key === 'r' || key === 'R') {
    for (const g of digits) Composite.remove(engine.world, g.body);
    digits = [];
  }
  if (keyCode === ESCAPE) { selected = null; drag = null; }
}

// ─────────── 声音 ───────────
// Web Audio，无外部文件。AudioContext 只在按下 click enter 时创建。
// 滴答跟每只表最快指针的转速。选中的表更响、略亮一点，并且不被全体间隔丢掉。
// 撞击只在 collisionStart 时响。

var audioCtx = null;
var audioMaster = null;
var noiseBuf = null;
var soundUnlocked = false;
var lastTickAt = -1;
var lastHitAt = -1;
var pairHitAt = new Map();
var bodyHitAt = new Map();

var TICK_TOOTH = 0.73;      // 最快指针每转过这么多弧度，尝试一次滴答
var TICK_MIN_GAP = 0.13;    // 单只表两次滴答的最短间隔（秒）
var TICK_GLOBAL_GAP = 0.15; // 全体滴答的最短间隔，九只表也不会叠成一片
var TICK_SEL_MIN_GAP = 0.032; // 选中的表更短，加快时滴答会变密，不被 0.15s 全体间隔吞掉
var TICK_SILENT = 0.04;     // 低于此转速（弧度/秒）不再滴答
var HIT_PAIR_MS = 260;
var HIT_BODY_MS = 120;
var HIT_GLOBAL_MS = 90;
var HIT_FALL_VY = 0.55;
var HIT_REL_SPEED = 0.85;

function armAudioUnlock() {
  const onGesture = (e) => {
    const raw = e.target;
    const n = raw && raw.nodeType === 1 ? raw : (raw && raw.parentElement);
    if (!n || !n.closest || !n.closest('#enter')) return;
    unlockAudio();
  };
  window.addEventListener('mousedown', onGesture, true);
  window.addEventListener('click', onGesture, true);
  window.addEventListener('touchstart', onGesture, { capture: true, passive: true });
}

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) {
    audioCtx = new AC();
    audioMaster = audioCtx.createGain();
    audioMaster.gain.value = 0.55;
    audioMaster.connect(audioCtx.destination);
    const n = Math.max(1, Math.floor(audioCtx.sampleRate * 0.06));
    noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audioCtx.state !== 'running') audioCtx.resume();
  soundUnlocked = true;
}

function audioReady() {
  return !!(soundUnlocked && simStarted && audioCtx && audioCtx.state === 'running' && noiseBuf);
}

function fastestOmega(c) {
  let w = 0;
  for (let i = 0; i < c.hands.length; i++) {
    const h = c.hands[i];
    const v = (drag && drag.hand === h) ? drag.vel : h.speed;
    const a = v < 0 ? -v : v;
    if (a > w) w = a;
  }
  return w;
}

function updateClockTicks(dt) {
  if (!audioReady() || !clocks.length) return;
  const now = audioCtx.currentTime;
  let sel = null;
  const due = [];
  for (let i = 0; i < clocks.length; i++) {
    const c = clocks[i];
    const w = fastestOmega(c);
    if (w < TICK_SILENT) { c.tickPhase = 0; continue; }
    const accent = c === selected;
    // 弧度间隔仍是 TICK_TOOTH，转速差会变成疏密差。选中表只把最短间隔缩短，
    // 并且多留一点相位，避免全体间隔把它卡住时把多转的角度丢掉。
    const gap = accent ? TICK_SEL_MIN_GAP : TICK_MIN_GAP;
    const cap = TICK_TOOTH * (accent ? 2 : 1.2);
    c.tickPhase = (c.tickPhase || 0) + w * dt;
    if (c.tickPhase > cap) c.tickPhase = cap;
    if (c.tickPhase < TICK_TOOTH) continue;
    if (now - (c.tickAt || 0) < gap) continue;
    const item = { c: c, w: w };
    if (accent) sel = item;
    else due.push(item);
  }
  if (sel) {
    if (now - lastTickAt < TICK_SEL_MIN_GAP) return;
    emitTick(sel, now, 'sel');
    return;
  }
  if (!due.length || now - lastTickAt < TICK_GLOBAL_GAP) return;
  let sum = 0;
  for (let i = 0; i < due.length; i++) sum += due[i].w;
  let r = Math.random() * sum;
  let pick = due[0];
  for (let i = 0; i < due.length; i++) {
    r -= due[i].w;
    if (r <= 0) { pick = due[i]; break; }
  }
  emitTick(pick, now, selected ? 'bg' : 'mix');
}

// 选中表的响滴答同时一记短触觉，不另开计时。手机用 vibrate；
// 这台 Mac 上桌面浏览器到不了触控板，所以顺手丢给本机 haptic-bridge。
// 桥没开也不等它，动画和声音照常走。
var HAPTIC_URL = 'http://127.0.0.1:8767/tap';

function tapSelectedClock() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
  } catch (err) {}
  try {
    if (typeof fetch !== 'function') return;
    var opts = { method: 'GET', mode: 'no-cors', cache: 'no-store' };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      opts.signal = AbortSignal.timeout(250);
    }
    fetch(HAPTIC_URL, opts).catch(function () {});
  } catch (err) {}
}

function emitTick(pick, now, role) {
  pick.c.tickPhase -= TICK_TOOTH;
  if (pick.c.tickPhase < 0) pick.c.tickPhase = 0;
  pick.c.tickAt = now;
  lastTickAt = now;
  playTick(pick.w, role);
  if (role === 'sel') tapSelectedClock();
}

function playTick(speed, role) {
  const lo = Math.log(0.08);
  const hi = Math.log(4);
  let u = (Math.log(Math.max(speed, 0.08)) - lo) / (hi - lo);
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  let dur = 0.016 - u * 0.007;
  let hpF = 600;
  let bpF = 1100 + u * 1700;
  let bq = 1.8 + u * 4;
  let peak = 0.032 + u * 0.03;
  if (role === 'sel') {
    dur = 0.021 - u * 0.006;
    hpF = 720;
    bpF = 1400 + u * 1800;
    bq = 2.4 + u * 4;
    // 很慢时仍然轻；转得越快越响，和背景拉开
    peak = 0.02 + u * 0.15;
  } else if (role === 'bg') {
    dur = 0.011 - u * 0.003;
    hpF = 460;
    bpF = 780 + u * 860;
    bq = 1.15 + u * 1.6;
    peak = 0.012 + u * 0.01;
  }
  const ctx = audioCtx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = hpF;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = bpF;
  bp.Q.value = bq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp);
  hp.connect(bp);
  bp.connect(g);
  g.connect(audioMaster);
  src.start(t);
  src.stop(t + dur + 0.02);
  src.onended = () => {
    src.disconnect();
    hp.disconnect();
    bp.disconnect();
    g.disconnect();
  };
}

function playHit(impact) {
  const ctx = audioCtx;
  const t = ctx.currentTime;
  let u = (impact - HIT_REL_SPEED) / 7;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  const dur = 0.07 + u * 0.04;
  const peak = 0.01 + u * 0.012;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240 + u * 90;
  lp.Q.value = 0.45;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.016);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const f0 = 96 + u * 36;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(48, f0 * 0.55), t + dur);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(peak * 0.45, t + 0.018);
  og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(g);
  g.connect(audioMaster);
  osc.connect(og);
  og.connect(audioMaster);
  src.start(t);
  src.stop(t + dur + 0.02);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  osc.onended = () => {
    src.disconnect();
    lp.disconnect();
    g.disconnect();
    osc.disconnect();
    og.disconnect();
  };
}

function bodyKind(b) {
  let x = b;
  for (let i = 0; i < 3 && x; i++) {
    const label = x.label;
    if (label === 'digit' || label === 'bowl' || label === 'hand' || label === 'title') return label;
    if (!x.parent || x.parent === x) break;
    x = x.parent;
  }
  return '';
}

function onCollisionStart(ev) {
  try { digitHitSound(ev); } catch (err) {}
}
function digitHitSound(ev) {
  if (!audioReady() || !ev || !ev.pairs) return;
  const now = performance.now();
  if (pairHitAt.size > 2000) pairHitAt.clear();
  if (bodyHitAt.size > 2000) bodyHitAt.clear();
  for (let i = 0; i < ev.pairs.length; i++) {
    const pair = ev.pairs[i];
    const a = pair.bodyA;
    const b = pair.bodyB;
    const ka = bodyKind(a);
    const kb = bodyKind(b);
    if (ka !== 'digit' && kb !== 'digit') continue;
    const other = ka === 'digit' ? kb : ka;
    if (other !== 'digit' && other !== 'bowl' && other !== 'hand' && other !== 'title') continue;
    if (other === 'title' && !(title && title.solid)) continue;
    const aFall = ka === 'digit' && a.velocity.y > HIT_FALL_VY && a.position.y > 8;
    const bFall = kb === 'digit' && b.velocity.y > HIT_FALL_VY && b.position.y > 8;
    if (!aFall && !bFall) continue;
    const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
    if (rel < HIT_REL_SPEED) continue;
    const idA = (ka !== 'digit' && a.parent && a.parent !== a) ? a.parent.id : a.id;
    const idB = (kb !== 'digit' && b.parent && b.parent !== b) ? b.parent.id : b.id;
    const lo = idA < idB ? idA : idB;
    const hi = idA < idB ? idB : idA;
    const key = lo + ':' + hi;
    if (now - (pairHitAt.get(key) || 0) < HIT_PAIR_MS) continue;
    const digitBody = aFall ? a : b;
    if (now - (bodyHitAt.get(digitBody.id) || 0) < HIT_BODY_MS) continue;
    if (now - lastHitAt < HIT_GLOBAL_MS) continue;
    pairHitAt.set(key, now);
    bodyHitAt.set(digitBody.id, now);
    if (aFall && bFall) bodyHitAt.set(a.id === digitBody.id ? b.id : a.id, now);
    lastHitAt = now;
    playHit(rel);
    break;
  }
}

armAudioUnlock();
