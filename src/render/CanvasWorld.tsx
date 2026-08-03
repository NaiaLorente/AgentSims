import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';
import { WORSE_OFF_THRESHOLD, type Agent, type World, type Zone } from '../sim/types';

const TILE = 32;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.75;

type Facing = 'north' | 'south' | 'east' | 'west';

interface AgentRenderState {
  x: number; // tile-space, fractional
  y: number;
  facing: Facing;
  walkPhase: number;
  moving: boolean;
}

interface Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
}

// ---------------------------------------------------------------------------
// Cheap deterministic pseudo-random hash, used only to scatter ground texture
// (tile brightness + grass tufts) so the field doesn't look like a flat grid.
// Purely cosmetic — has no bearing on where anything actually is.
// ---------------------------------------------------------------------------
function hash01(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10000) / 10000;
}

function drawGround(ctx: CanvasRenderingContext2D, world: World, t: number) {
  const w = world.width * TILE;
  const h = world.height * TILE;

  ctx.fillStyle = '#232f22';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const variance = hash01(x, y, 1);
      const lightness = 0.85 + variance * 0.3; // 0.85 .. 1.15
      const base = 38 + variance * 12;
      ctx.fillStyle = `hsl(100, 18%, ${base * lightness}%)`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

      // occasional grass tuft for texture, static per-tile so it doesn't flicker
      if (hash01(x, y, 2) > 0.82) {
        const tx = x * TILE + TILE * (0.3 + hash01(x, y, 3) * 0.4);
        const ty = y * TILE + TILE * (0.5 + hash01(x, y, 4) * 0.35);
        ctx.strokeStyle = 'rgba(90, 130, 70, 0.5)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const sway = Math.sin(t * 1.2 + x + y + i) * 1.2;
          ctx.beginPath();
          ctx.moveTo(tx + i * 2 - 2, ty);
          ctx.lineTo(tx + i * 2 - 2 + sway, ty - 5);
          ctx.stroke();
        }
      }
    }
  }

  // very faint seams, just enough to read tile scale without looking like graph paper
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= world.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(w, y * TILE);
    ctx.stroke();
  }
  for (let x = 0; x <= world.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, h);
    ctx.stroke();
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Spreads agents standing on the same tile into a small circular cluster so they don't fully overlap. */
function groupOffset(index: number, count: number): { dx: number; dy: number } {
  if (count <= 1) return { dx: 0, dy: 0 };
  const radius = 10;
  const angle = (index / count) * Math.PI * 2;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

function agentTargets(agentOrder: string[], agents: Record<string, Agent>): Map<string, { x: number; y: number }> {
  const groups = new Map<string, string[]>();
  for (const id of agentOrder) {
    const agent = agents[id];
    if (!agent) continue;
    const key = `${agent.pos.x},${agent.pos.y}`;
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  }
  const targets = new Map<string, { x: number; y: number }>();
  for (const id of agentOrder) {
    const agent = agents[id];
    if (!agent) continue;
    const key = `${agent.pos.x},${agent.pos.y}`;
    const group = groups.get(key)!;
    const { dx, dy } = groupOffset(group.indexOf(id), group.length);
    targets.set(id, {
      x: agent.pos.x * TILE + TILE / 2 + dx,
      y: agent.pos.y * TILE + TILE / 2 + dy,
    });
  }
  return targets;
}

/** Eases each agent's rendered position toward its true grid position every frame, independent
 *  of tick rate — turns the underlying tile-by-tile snapping into a smooth glide, and drives the
 *  walk-cycle/facing animation off of how far there still is to go. */
function updateRenderState(
  render: Map<string, AgentRenderState>,
  agentOrder: string[],
  agents: Record<string, Agent>,
  targets: Map<string, { x: number; y: number }>,
  dt: number,
) {
  const seen = new Set<string>();
  for (const id of agentOrder) {
    const agent = agents[id];
    const target = targets.get(id);
    if (!agent || !target) continue;
    seen.add(id);

    let s = render.get(id);
    if (!s) {
      s = { x: target.x, y: target.y, facing: 'south', walkPhase: 0, moving: false };
      render.set(id, s);
    }

    const dx = target.x - s.x;
    const dy = target.y - s.y;
    const dist = Math.hypot(dx, dy);
    const ease = Math.min(1, dt * 9);
    s.x += dx * ease;
    s.y += dy * ease;

    s.moving = dist > 0.6;
    if (s.moving) {
      s.walkPhase += dt * 9;
      if (Math.abs(dx) > Math.abs(dy)) s.facing = dx > 0 ? 'east' : 'west';
      else if (Math.abs(dy) > 0.1) s.facing = dy > 0 ? 'south' : 'north';
    } else {
      s.walkPhase *= 0.85;
    }
  }
  for (const id of [...render.keys()]) {
    if (!seen.has(id)) render.delete(id);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  selected: boolean,
  tick: number,
  cx: number,
  cy: number,
  s: AgentRenderState,
) {
  const bodyW = TILE * 0.5;
  const bodyH = TILE * 0.62;
  const worseOff = agent.condition < WORSE_OFF_THRESHOLD;
  const color = agent.model ? (worseOff ? shade(agent.color, -35) : agent.color) : '#525a66';
  const bob = s.moving ? Math.sin(s.walkPhase * 2) * 1.6 : 0;
  const top = cy - bodyH / 2 + bob;

  // shadow
  ctx.beginPath();
  ctx.ellipse(cx, cy + bodyH / 2 + 2, bodyW * 0.45, bodyW * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  if (selected) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, bodyW * 0.75, bodyW * 0.32, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // legs (alternate while walking)
  const legSwing = s.moving ? Math.sin(s.walkPhase * 2) * 4 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - bodyW * 0.2, cy + bodyH / 2 - 1 + Math.max(0, legSwing), 2.6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + bodyW * 0.2, cy + bodyH / 2 - 1 + Math.max(0, -legSwing), 2.6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // body (rounded capsule)
  roundRect(ctx, cx - bodyW / 2, top, bodyW, bodyH, bodyW / 2);
  const grad = ctx.createLinearGradient(cx, top, cx, top + bodyH);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -18));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();

  // face visor
  const visorW = bodyW * 0.62;
  const visorH = bodyH * 0.32;
  const visorY = top + bodyH * 0.28;
  roundRect(ctx, cx - visorW / 2, visorY, visorW, visorH, visorH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();

  // eyes, shifted toward whatever direction the agent is facing
  const eyeShift: Record<Facing, [number, number]> = {
    south: [0, 0.15],
    north: [0, -0.15],
    east: [0.35, 0],
    west: [-0.35, 0],
  };
  const [ex, ey] = eyeShift[s.facing];
  const eyeCx = cx + visorW * ex * 0.5;
  const eyeCy = visorY + visorH / 2 + visorH * ey;
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(eyeCx - visorW * 0.15, eyeCy, 1.6, 0, Math.PI * 2);
  ctx.arc(eyeCx + visorW * 0.15, eyeCy, 1.6, 0, Math.PI * 2);
  ctx.fill();

  const statusIcon: Record<string, string> = { talking: '💬', thinking: '…' };
  const icon = statusIcon[agent.activity.kind];
  if (icon) {
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx + bodyW / 2 + 8, top - 2);
  }

  ctx.font = '11px system-ui';
  ctx.fillStyle = '#f9fafb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(agent.label, cx, cy + bodyH / 2 + 12);

  if (agent.speech && agent.speech.expiresAtTick > tick) {
    drawSpeechBubble(ctx, cx, top - 10, agent.speech.text);
  }
}

function shade(hex: string, percent: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const amt = Math.round((percent / 100) * 255);
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Zones — fixed places on the map, each drawn as a small illustrated scene
// sized to its footprint rather than a single icon, since agents actually
// stand inside this area (not just next to a point).
// ---------------------------------------------------------------------------

/** FNV-1a — needs good avalanche even for near-identical short strings
 *  (e.g. "house-a" vs "house-b"), which a naive polynomial hash doesn't give. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

function drawZoneLabel(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string) {
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(text).width;
  const boxW = textW + 12;
  const boxH = 14;
  roundRect(ctx, cx - boxW / 2, y - boxH / 2, boxW, boxH, 4);
  ctx.fillStyle = 'rgba(10,14,10,0.6)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, cx, y + 0.5);
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, cx: number, groundY: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = '#bfe3f0';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, size, size);
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.moveTo(x, y + size / 2);
  ctx.lineTo(x + size, y + size / 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();
}

function drawHouseScene(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: number,
  t: number,
  ownerColor: string | null,
) {
  const cx = x + w / 2;
  const groundY = y + h * 0.82;
  drawGroundShadow(ctx, cx, groundY, w * 0.32, h * 0.06);

  const bodyW = w * 0.56;
  const bodyH = h * 0.4;
  const bodyTop = groundY - bodyH;
  const bodyLeft = cx - bodyW / 2;

  const wallColor = variant > 0.5 ? '#e9d9b8' : '#dcc9a3';
  const roofColor = variant > 0.5 ? '#b5542c' : '#8a4a5f';

  ctx.fillStyle = wallColor;
  ctx.fillRect(bodyLeft, bodyTop, bodyW, bodyH);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyLeft, bodyTop, bodyW, bodyH);

  const overhang = bodyW * 0.15;
  const roofH = h * 0.28;
  ctx.beginPath();
  ctx.moveTo(bodyLeft - overhang, bodyTop + 2);
  ctx.lineTo(cx, bodyTop - roofH);
  ctx.lineTo(bodyLeft + bodyW + overhang, bodyTop + 2);
  ctx.closePath();
  ctx.fillStyle = roofColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();

  const chimX = bodyLeft + bodyW * 0.7;
  const chimW = bodyW * 0.12;
  const chimTopY = bodyTop - roofH * 0.55;
  ctx.fillStyle = shade(roofColor, -15);
  ctx.fillRect(chimX, chimTopY, chimW, roofH * 0.5);

  for (let i = 0; i < 3; i++) {
    const puffT = (t * 0.6 + i * 0.4) % 1.5;
    const puffY = chimTopY - puffT * 14;
    const puffX = chimX + chimW / 2 + Math.sin(t + i) * 2;
    const alpha = Math.max(0, 0.35 - puffT * 0.22);
    ctx.beginPath();
    ctx.arc(puffX, puffY, 2 + puffT * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }

  const doorW = bodyW * 0.22;
  const doorH = bodyH * 0.55;
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(cx - doorW / 2, groundY - doorH, doorW, doorH);

  drawWindow(ctx, bodyLeft + bodyW * 0.16, bodyTop + bodyH * 0.2, bodyW * 0.18);

  if (ownerColor) {
    // a little pennant on the roof peak, in the owner's own color — the only visual claim
    // of ownership, since anyone else is turned away if they try to rest here.
    const poleX = cx;
    const poleTopY = bodyTop - roofH - 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(poleX, bodyTop - roofH);
    ctx.lineTo(poleX, poleTopY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(poleX, poleTopY);
    ctx.lineTo(poleX + 7, poleTopY + 3);
    ctx.lineTo(poleX, poleTopY + 6);
    ctx.closePath();
    ctx.fillStyle = ownerColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }
}

function drawAwning(
  ctx: CanvasRenderingContext2D,
  bodyLeft: number,
  bodyTop: number,
  bodyW: number,
  awningH: number,
  accent: string,
) {
  const stripes = 6;
  const stripeW = bodyW / stripes;
  const awningTop = bodyTop - awningH;
  for (let i = 0; i < stripes; i++) {
    const sx = bodyLeft + i * stripeW;
    ctx.beginPath();
    ctx.moveTo(sx, awningTop);
    ctx.lineTo(sx + stripeW, awningTop);
    ctx.lineTo(sx + stripeW, bodyTop);
    ctx.lineTo(sx + stripeW / 2, bodyTop + 4);
    ctx.lineTo(sx, bodyTop);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? accent : '#f5f5f5';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function drawShopScene(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  const groundY = y + h * 0.82;
  drawGroundShadow(ctx, cx, groundY, w * 0.34, h * 0.06);

  const bodyW = w * 0.62;
  const bodyH = h * 0.36;
  const bodyTop = groundY - bodyH;
  const bodyLeft = cx - bodyW / 2;

  ctx.fillStyle = '#dbe6ef';
  ctx.fillRect(bodyLeft, bodyTop, bodyW, bodyH);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyLeft, bodyTop, bodyW, bodyH);

  const winW = bodyW * 0.5;
  const winH = bodyH * 0.55;
  const winX = bodyLeft + bodyW * 0.08;
  const winY = bodyTop + bodyH * 0.32;
  ctx.fillStyle = '#89c9e8';
  ctx.fillRect(winX, winY, winW, winH);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(winX, winY, winW, winH);
  ['#f97316', '#eab308', '#ef4444'].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(winX + winW * (0.25 + i * 0.25), winY + winH * 0.68, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  const doorW = bodyW * 0.2;
  const doorH = bodyH * 0.62;
  ctx.fillStyle = '#3b5169';
  ctx.fillRect(bodyLeft + bodyW - doorW - bodyW * 0.06, groundY - doorH, doorW, doorH);

  drawAwning(ctx, bodyLeft, bodyTop, bodyW, h * 0.14, '#3b82f6');
}

function drawRestaurantScene(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w * 0.4;
  const groundY = y + h * 0.82;
  drawGroundShadow(ctx, cx, groundY, w * 0.28, h * 0.06);

  const bodyW = w * 0.5;
  const bodyH = h * 0.36;
  const bodyTop = groundY - bodyH;
  const bodyLeft = cx - bodyW / 2;

  ctx.fillStyle = '#ecdcc0';
  ctx.fillRect(bodyLeft, bodyTop, bodyW, bodyH);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyLeft, bodyTop, bodyW, bodyH);

  drawWindow(ctx, bodyLeft + bodyW * 0.12, bodyTop + bodyH * 0.3, bodyW * 0.26);

  const doorW = bodyW * 0.24;
  const doorH = bodyH * 0.6;
  ctx.fillStyle = '#6b3a2a';
  ctx.fillRect(bodyLeft + bodyW - doorW - bodyW * 0.1, groundY - doorH, doorW, doorH);

  drawAwning(ctx, bodyLeft, bodyTop, bodyW, h * 0.15, '#ef4444');

  // outdoor seating beside the building
  const tableX = x + w * 0.82;
  drawGroundShadow(ctx, tableX, groundY, w * 0.1, h * 0.04);
  ctx.fillStyle = 'rgba(60,40,20,0.7)';
  ctx.beginPath();
  ctx.moveTo(tableX, groundY - h * 0.28);
  ctx.lineTo(tableX, groundY - h * 0.03);
  ctx.strokeStyle = 'rgba(60,40,20,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tableX - w * 0.1, groundY - h * 0.28);
  ctx.lineTo(tableX, groundY - h * 0.4);
  ctx.lineTo(tableX + w * 0.1, groundY - h * 0.28);
  ctx.closePath();
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(tableX, groundY - h * 0.03, w * 0.07, h * 0.025, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#caa06e';
  ctx.fill();
}

function drawTree(ctx: CanvasRenderingContext2D, cx: number, groundY: number, size: number, seed: number, t: number) {
  const trunkW = size * 0.18;
  const trunkH = size * 0.5;
  drawGroundShadow(ctx, cx, groundY, size * 0.45, size * 0.12);
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(cx - trunkW / 2, groundY - trunkH, trunkW, trunkH);

  const sway = Math.sin(t * 1.3 + seed * 10) * 1.5;
  const greens = ['#2f9e44', '#37b24d', '#40c057'];
  const canopyY = groundY - trunkH - size * 0.3;
  const offsets: [number, number][] = [
    [-0.28, 0],
    [0.28, 0],
    [0, -0.3],
  ];
  offsets.forEach(([dx, dy], i) => {
    ctx.beginPath();
    ctx.arc(cx + dx * size + sway * 0.3, canopyY + dy * size, size * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = greens[(i + Math.floor(seed * 3)) % greens.length];
    ctx.fill();
  });
}

function drawBench(ctx: CanvasRenderingContext2D, cx: number, groundY: number, size: number) {
  const w = size * 1.1;
  const seatH = size * 0.12;
  const backH = size * 0.35;
  drawGroundShadow(ctx, cx, groundY, w * 0.55, size * 0.1);
  ctx.fillStyle = '#8a6d3b';
  ctx.fillRect(cx - w / 2 + 2, groundY - seatH, 2, seatH);
  ctx.fillRect(cx + w / 2 - 4, groundY - seatH, 2, seatH);
  ctx.fillRect(cx - w / 2, groundY - seatH - 3, w, 3);
  ctx.fillRect(cx - w / 2, groundY - seatH - backH, w, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2, groundY - seatH - backH, w, backH);
}

function drawParkScene(ctx: CanvasRenderingContext2D, zone: Zone, x: number, y: number, w: number, h: number, t: number) {
  const positions: [number, number][] = [
    [0.2, 0.22],
    [0.8, 0.25],
    [0.78, 0.78],
  ];
  positions.forEach(([dx, dy], i) => {
    const seed = hashStr(`${zone.id}-tree-${i}`);
    const cx = x + w * (dx + (seed - 0.5) * 0.06);
    const groundY = y + h * (dy + (seed - 0.5) * 0.05);
    drawTree(ctx, cx, groundY, Math.min(w, h) * 0.24, seed, t);
  });
  drawBench(ctx, x + w * 0.25, y + h * 0.72, Math.min(w, h) * 0.2);
}

function drawBoardScene(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, noticeCount: number) {
  const cx = x + w / 2;
  const groundY = y + h * 0.85;
  drawGroundShadow(ctx, cx, groundY, w * 0.28, h * 0.06);

  const postW = w * 0.06;
  ctx.fillStyle = '#8a6d3b';
  ctx.fillRect(cx - w * 0.32, groundY - h * 0.1, postW, h * 0.1);
  ctx.fillRect(cx + w * 0.32 - postW, groundY - h * 0.1, postW, h * 0.1);

  const boardW = w * 0.72;
  const boardH = h * 0.5;
  const boardLeft = cx - boardW / 2;
  const boardTop = groundY - h * 0.1 - boardH;
  ctx.fillStyle = '#9c7a45';
  ctx.fillRect(boardLeft, boardTop, boardW, boardH);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(boardLeft, boardTop, boardW, boardH);

  // a few pinned "notes" — just enough to be visually distinct, not literally one per notice
  const noteColors = ['#fde68a', '#bbf7d0', '#fecaca', '#bfdbfe'];
  const shown = Math.min(noticeCount, 4);
  for (let i = 0; i < shown; i++) {
    const noteW = boardW * 0.22;
    const noteH = boardH * 0.32;
    const nx = boardLeft + boardW * 0.1 + (i % 2) * boardW * 0.42;
    const ny = boardTop + boardH * 0.14 + Math.floor(i / 2) * boardH * 0.42;
    ctx.fillStyle = noteColors[i % noteColors.length];
    ctx.fillRect(nx, ny, noteW, noteH);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(nx, ny, noteW, noteH);
  }
}

function drawZone(ctx: CanvasRenderingContext2D, zone: Zone, t: number, ownerColor: string | null, noticeCount: number) {
  const x = zone.bounds.x * TILE;
  const y = zone.bounds.y * TILE;
  const w = zone.bounds.w * TILE;
  const h = zone.bounds.h * TILE;

  // subtle footprint so the walkable area is still legible under the scene
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (zone.kind === 'house') {
    drawHouseScene(ctx, x, y, w, h, hashStr(zone.id), t, ownerColor);
  } else if (zone.kind === 'shop') {
    drawShopScene(ctx, x, y, w, h);
  } else if (zone.kind === 'restaurant') {
    drawRestaurantScene(ctx, x, y, w, h);
  } else if (zone.kind === 'board') {
    drawBoardScene(ctx, x, y, w, h, noticeCount);
  } else {
    drawParkScene(ctx, zone, x, y, w, h, t);
  }

  const label = zone.kind === 'house' && zone.ownerLabel ? `${zone.name} · ${zone.ownerLabel}'s` : zone.name;
  drawZoneLabel(ctx, x + w / 2, y - 8, label);
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  const maxWidth = 180;
  ctx.font = '11px system-ui';
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const lineHeight = 14;
  const boxW = Math.min(maxWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16;
  const boxH = lines.length * lineHeight + 10;
  const boxX = x - boxW / 2;
  const boxY = y - boxH;

  ctx.fillStyle = 'rgba(17,20,28,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f3f4f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillText(l, x, boxY + 8 + i * lineHeight + lineHeight / 2);
  });
}

export function CanvasWorld() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const renderStateRef = useRef<Map<string, AgentRenderState>>(new Map());
  const cameraRef = useRef<Camera>({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTs = performance.now();

    const render = (ts: number) => {
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      const t = ts / 1000;

      const state = useSimStore.getState();
      const w = state.world.width * TILE;
      const h = state.world.height * TILE;
      canvas.width = w;
      canvas.height = h;

      const cam = cameraRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#141a13';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(cam.offsetX, cam.offsetY);
      ctx.scale(cam.scale, cam.scale);

      drawGround(ctx, state.world, t);

      for (const zone of state.zones) {
        const ownerColor = zone.ownerId ? (state.agents[zone.ownerId]?.color ?? null) : null;
        const noticeCount = zone.kind === 'board' ? state.notices.length : 0;
        drawZone(ctx, zone, t, ownerColor, noticeCount);
      }

      const targets = agentTargets(state.agentOrder, state.agents);
      updateRenderState(renderStateRef.current, state.agentOrder, state.agents, targets, dt);
      for (const id of state.agentOrder) {
        const agent = state.agents[id];
        const target = targets.get(id);
        const rs = renderStateRef.current.get(id);
        if (!agent || !target || !rs) continue;
        drawAgent(ctx, agent, state.selectedAgentId === id, state.clock.tick, rs.x, rs.y, rs);
      }

      drawVignette(ctx, w, h);
      ctx.restore();

      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleFactor = canvas.width / rect.width;
      const mx = (e.clientX - rect.left) * scaleFactor;
      const my = (e.clientY - rect.top) * scaleFactor;
      const worldX = (mx - cam.offsetX) / cam.scale;
      const worldY = (my - cam.offsetY) / cam.scale;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      cam.offsetX = mx - worldX * next;
      cam.offsetY = my - worldY * next;
      cam.scale = next;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleFactor = canvas.width / rect.width;
    return { x: (e.clientX - rect.left) * scaleFactor, y: (e.clientY - rect.top) * scaleFactor };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e);
    const cam = cameraRef.current;
    dragRef.current = { startX: x, startY: y, camX: cam.offsetX, camY: cam.offsetY, moved: false };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toCanvasCoords(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.moved) {
      cameraRef.current.offsetX = drag.camX + dx;
      cameraRef.current.offsetY = drag.camY + dy;
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return; // was a pan, not a click

    const { x, y } = toCanvasCoords(e);
    const cam = cameraRef.current;
    const worldX = (x - cam.offsetX) / cam.scale;
    const worldY = (y - cam.offsetY) / cam.scale;

    const state = useSimStore.getState();
    let hit: string | null = null;
    for (const id of state.agentOrder) {
      const rs = renderStateRef.current.get(id);
      if (!rs) continue;
      if (Math.hypot(rs.x - worldX, rs.y - worldY) <= TILE * 0.5) {
        hit = id;
        break;
      }
    }
    state.selectAgent(hit);
  };

  const handleDoubleClick = () => {
    cameraRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        className="rounded-lg border border-white/10 shadow-lg cursor-grab active:cursor-grabbing max-w-full"
      />
      <p className="text-[10px] text-white/35">scroll to zoom · drag to pan · double-click to reset view</p>
    </div>
  );
}
