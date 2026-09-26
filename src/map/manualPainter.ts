// Next-turn indicator for manual driving: a badge above the player's tuk-tuk
// with an arrow for the way it will leave the next junction, and a chevron on
// the map at that junction.

import { isManualDriven, manualControl, previewTurn, type TurnPreview } from '../sim/manual';
import { registerPainter, type PaintContext } from './painters';

const COLOR = { turn: '#e8b923', route: '#e0457b', road: '#fbf3e2', arrive: '#3aa35b' };

function arrowPath(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.72, -size * 0.1);
  ctx.lineTo(size * 0.26, -size * 0.1);
  ctx.lineTo(size * 0.26, size * 0.85);
  ctx.lineTo(-size * 0.26, size * 0.85);
  ctx.lineTo(-size * 0.26, -size * 0.1);
  ctx.lineTo(-size * 0.72, -size * 0.1);
  ctx.closePath();
}

/**
 * Badge above the tuk-tuk: the next turn relative to the direction of travel
 * (up = straight on), coloured by who chose it, and the distance to it.
 */
function drawBadge(p: PaintContext, x: number, y: number, preview: TurnPreview): void {
  const ctx = p.ctx;
  const color = COLOR[preview.source];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(43, 29, 18, 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  if (!preview.exit) {
    // Destination ahead: a pin dot.
    ctx.beginPath();
    ctx.arc(0, -2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-1.5, 2, 3, 7);
  } else if (preview.exit.kind === 'uturn') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-1, -1, 5, 0, Math.PI, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, -1);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-2, -1);
    ctx.fill();
  } else {
    ctx.rotate(-preview.exit.delta);
    arrowPath(ctx, 9);
    ctx.fill();
  }
  ctx.restore();
  const label = `${Math.round(preview.distance / 10) * 10} m`;
  ctx.save();
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(43, 29, 18, 0.9)';
  ctx.strokeText(label, x, y + 28);
  ctx.fillStyle = '#fbf3e2';
  ctx.fillText(label, x, y + 28);
  ctx.restore();
}

/** Chevron at the junction, pointing along the arc the tuk-tuk will take. */
function drawJunction(p: PaintContext, preview: TurnPreview): void {
  if (!preview.exit) return;
  const graph = p.game.world.graph;
  const at = p.toScreen(graph.nodeX[preview.node], graph.nodeY[preview.node]);
  const ahead = graph.poseAt(preview.exit.arc, Math.min(18, graph.arcLen(preview.exit.arc)));
  const to = p.toScreen(ahead.x, ahead.y);
  const angle = Math.atan2(to.y - at.y, to.x - at.x);
  const ctx = p.ctx;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = COLOR[preview.source];
  ctx.strokeStyle = 'rgba(43, 29, 18, 0.85)';
  ctx.lineWidth = 2;
  arrowPath(ctx, 11);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

registerPainter({
  id: 'manual-turn',
  layer: 'over',
  paint(p) {
    const v = p.game.playerVehicle();
    if (!v || !manualControl(p.game).on || !isManualDriven(p.game, v)) return;
    const preview = previewTurn(p.game, v);
    if (!preview) return;
    drawJunction(p, preview);
    const pose = p.game.vehiclePose(v);
    const s = p.toScreen(pose.x, pose.y);
    const lift = Math.max(30, Math.min(52, 30 + (p.zoom - 14) * 6));
    drawBadge(p, s.x, s.y - lift, preview);
  },
});
