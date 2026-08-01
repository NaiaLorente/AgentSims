import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';
import type { Agent, World } from '../sim/types';

const TILE = 32;

/** Spreads agents standing on the same tile into a small circular cluster so they don't fully overlap. */
function groupOffset(index: number, count: number): { dx: number; dy: number } {
  if (count <= 1) return { dx: 0, dy: 0 };
  const radius = 9;
  const angle = (index / count) * Math.PI * 2;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

function agentScreenCenters(
  agentOrder: string[],
  agents: Record<string, Agent>,
): Map<string, { cx: number; cy: number }> {
  const groups = new Map<string, string[]>();
  for (const id of agentOrder) {
    const agent = agents[id];
    if (!agent) continue;
    const key = `${agent.pos.x},${agent.pos.y}`;
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  }
  const centers = new Map<string, { cx: number; cy: number }>();
  for (const id of agentOrder) {
    const agent = agents[id];
    if (!agent) continue;
    const key = `${agent.pos.x},${agent.pos.y}`;
    const group = groups.get(key)!;
    const { dx, dy } = groupOffset(group.indexOf(id), group.length);
    centers.set(id, { cx: agent.pos.x * TILE + TILE / 2 + dx, cy: agent.pos.y * TILE + TILE / 2 + dy });
  }
  return centers;
}

function tileColor(kind: string): string {
  switch (kind) {
    case 'water':
      return '#1e3a5f';
    case 'blocked':
      return '#2a2d36';
    case 'path':
      return '#4b4735';
    default:
      return '#2f3a2a';
  }
}

function drawWorld(ctx: CanvasRenderingContext2D, world: World) {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      ctx.fillStyle = tileColor(world.tiles[y][x]);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= world.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(world.width * TILE, y * TILE);
    ctx.stroke();
  }
  for (let x = 0; x <= world.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, world.height * TILE);
    ctx.stroke();
  }

  for (const loc of world.locations) {
    const xs = loc.footprint.map((t) => t.x);
    const ys = loc.footprint.map((t) => t.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1;
    const h = Math.max(...ys) - y0 + 1;
    ctx.fillStyle = loc.color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0 * TILE, y0 * TILE, w * TILE, h * TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(x0 * TILE + 0.5, y0 * TILE + 0.5, w * TILE - 1, h * TILE - 1);

    ctx.font = `${TILE * 0.6}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loc.emoji, (x0 + w / 2) * TILE, (y0 + h / 2) * TILE);

    ctx.font = '11px system-ui';
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(loc.name, (x0 + w / 2) * TILE, y0 * TILE - 6);
  }
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  selected: boolean,
  tick: number,
  center: { cx: number; cy: number },
) {
  const cx = center.cx;
  const cy = center.cy;
  const r = agent.isChild ? TILE * 0.28 : TILE * 0.38;

  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = agent.color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();

  ctx.font = `${r * 1.3}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(agent.emoji, cx, cy);

  // status ring for what they're doing
  const statusIcon: Record<string, string> = {
    sleeping: '💤',
    eating: '🍽️',
    relaxing: '🎈',
    talking: '💬',
    thinking: '…',
  };
  const icon = statusIcon[agent.activity.kind];
  if (icon) {
    ctx.font = '13px system-ui';
    ctx.fillText(icon, cx + r + 6, cy - r);
  }

  ctx.font = '11px system-ui';
  ctx.fillStyle = '#f9fafb';
  ctx.fillText(agent.name, cx, cy + r + 10);

  if (agent.speech && agent.speech.expiresAtTick > tick) {
    drawSpeechBubble(ctx, cx, cy - r - 10, agent.speech.text);
  }
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  const maxWidth = 160;
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function CanvasWorld() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const state = useSimStore.getState();
      canvas.width = state.world.width * TILE;
      canvas.height = state.world.height * TILE;
      drawWorld(ctx, state.world);

      const centers = agentScreenCenters(state.agentOrder, state.agents);
      for (const id of state.agentOrder) {
        const agent = state.agents[id];
        if (!agent) continue;
        const center = centers.get(id)!;
        drawAgent(ctx, agent, state.selectedAgentId === id, state.clock.tick, center);
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const state = useSimStore.getState();
    const centers = agentScreenCenters(state.agentOrder, state.agents);
    let hit: string | null = null;
    for (const id of state.agentOrder) {
      const center = centers.get(id);
      if (!center) continue;
      if (Math.hypot(center.cx - x, center.cy - y) <= TILE * 0.5) {
        hit = id;
        break;
      }
    }
    state.selectAgent(hit);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="rounded-lg border border-white/10 shadow-lg cursor-pointer max-w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
