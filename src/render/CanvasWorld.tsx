import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';
import type { Agent, World, WorldObject } from '../sim/types';

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
  const color = agent.model ? agent.color : '#525a66';
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
// World object icons — a distinct little pictogram per known natural material,
// and a "monument" for agent-made things that visibly grows as more agents
// contribute to it. The engine still never interprets `content` itself; this
// is purely how the same string looks at a glance vs. having to read it.
// ---------------------------------------------------------------------------

function drawWaterIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1d6fa5';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,245,255,0.75)';
  ctx.lineWidth = 1.4;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    const yy = cy + i * r * 0.4;
    ctx.moveTo(cx - r * 0.6, yy);
    for (let px = -0.6; px <= 0.6; px += 0.2) {
      ctx.lineTo(cx + px * r, yy + Math.sin(t * 2 + px * 6 + i) * 1.5);
    }
    ctx.stroke();
  }
}

function drawFireIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number) {
  const flick = Math.sin(t * 8) * 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.9, cy + r * 0.2, cx - r * 0.35, cy - r * 0.3 + flick);
  ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 0.6, cx, cy - r * 1.1 + flick);
  ctx.quadraticCurveTo(cx + r * 0.15, cy - r * 0.5, cx + r * 0.4, cy - r * 0.2 - flick);
  ctx.quadraticCurveTo(cx + r * 0.9, cy + r * 0.2, cx, cy + r);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, '#fde047');
  grad.addColorStop(0.6, '#f97316');
  grad.addColorStop(1, '#b91c1c');
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawWoodIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.35);
  roundRect(ctx, -r * 1.1, -r * 0.45, r * 2.2, r * 0.9, r * 0.4);
  ctx.fillStyle = '#7c4a1e';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(r * 0.95, 0, r * 0.28, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#a8703a';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(r * 0.95, 0, r * 0.14, r * 0.2, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  ctx.restore();
}

function drawStoneIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx - r, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.5, cy - r * 0.7);
  ctx.lineTo(cx + r * 0.2, cy - r);
  ctx.lineTo(cx + r, cy - r * 0.2);
  ctx.lineTo(cx + r * 0.8, cy + r * 0.6);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#8b93a1';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy - r * 0.3);
  ctx.lineTo(cx + r * 0.3, cy - r * 0.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
}

function drawMonumentIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, layers: number) {
  const n = Math.max(1, Math.min(5, layers));
  for (let i = 0; i < n; i++) {
    const w = r * 1.7 * (1 - i * 0.16);
    const h = r * 0.5;
    const y = cy + r * 0.7 - i * (h * 0.75);
    roundRect(ctx, cx - w / 2, y - h, w, h, 3);
    ctx.fillStyle = i === n - 1 ? color : shade(color, -12 * i);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const NATURAL_ICONS: Record<string, (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number) => void> = {
  water: (ctx, cx, cy, r, t) => drawWaterIcon(ctx, cx, cy, r, t),
  fire: (ctx, cx, cy, r, t) => drawFireIcon(ctx, cx, cy, r, t),
  wood: (ctx, cx, cy, r) => drawWoodIcon(ctx, cx, cy, r),
  stone: (ctx, cx, cy, r) => drawStoneIcon(ctx, cx, cy, r),
};

function drawObject(ctx: CanvasRenderingContext2D, obj: WorldObject, creatorColor: string, t: number) {
  const cx = obj.pos.x * TILE + TILE / 2;
  const cy = obj.pos.y * TILE + TILE / 2;
  const r = TILE * 0.28;

  const icon = obj.natural ? NATURAL_ICONS[obj.content] : undefined;
  if (icon) {
    icon(ctx, cx, cy, r, t);
  } else if (obj.natural) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
  } else {
    drawMonumentIcon(ctx, cx, cy, r, creatorColor, 1 + obj.additions.length);
  }

  const suffix = obj.additions.length > 0 ? ` (+${obj.additions.length})` : '';
  const base = obj.content.length > 22 ? `${obj.content.slice(0, 22)}…` : obj.content;
  const caption = `${base}${suffix}`;
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(caption, cx, cy + r + 10);
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

      const colorFor = (id: string | null) => (id && state.agents[id]?.model ? state.agents[id].color : '#34d399');
      for (const obj of state.worldObjects) {
        drawObject(ctx, obj, colorFor(obj.creatorId), t);
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
