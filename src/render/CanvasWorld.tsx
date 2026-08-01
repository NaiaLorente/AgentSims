import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';
import type { Agent, World, WorldObject } from '../sim/types';

const TILE = 32;

function drawWorld(ctx: CanvasRenderingContext2D, world: World) {
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, world.width * TILE, world.height * TILE);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
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
}

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

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  selected: boolean,
  tick: number,
  center: { cx: number; cy: number },
) {
  const cx = center.cx;
  const cy = center.cy;
  const r = TILE * 0.36;

  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = agent.model ? agent.color : '#4b5563';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();

  const statusIcon: Record<string, string> = {
    talking: '💬',
    thinking: '…',
  };
  const icon = statusIcon[agent.activity.kind];
  if (icon) {
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx + r + 6, cy - r);
  }

  ctx.font = '11px system-ui';
  ctx.fillStyle = '#f9fafb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(agent.label, cx, cy + r + 10);

  if (agent.speech && agent.speech.expiresAtTick > tick) {
    drawSpeechBubble(ctx, cx, cy - r - 10, agent.speech.text);
  }
}

function drawObject(ctx: CanvasRenderingContext2D, obj: WorldObject) {
  const cx = obj.pos.x * TILE + TILE / 2;
  const cy = obj.pos.y * TILE + TILE / 2;
  const s = TILE * 0.22;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#34d399';
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();

  const caption = obj.content.length > 26 ? `${obj.content.slice(0, 26)}…` : obj.content;
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(caption, cx, cy + s / 2 + 9);
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

      for (const obj of state.worldObjects) {
        drawObject(ctx, obj);
      }

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
