import { useEffect, useRef, useState } from 'react';
import type { TripResult } from '../../sim/dispatch';
import { baht, stars } from '../format';
import type { OverlayProps } from '../overlays';
import './drive.css';

interface Fx {
  id: number;
  x: number;
  y: number;
  text: string;
  stars: string;
}

/** Milliseconds the fare text and stars stay up. */
const FX_MS = 2600;
/** Coins per payment: a few, more for a bigger fare. */
const coinCount = (fare: number, tip: number): number => Math.min(9, 3 + Math.round(fare / 60) + (tip > 0 ? 2 : 0));

let nextId = 1;

/**
 * Drop-off feedback for your own tuk-tuk: coins fly from the tuk-tuk to the
 * cash counter in the top bar, stars pop above it and the fare, tip and
 * rating float up ("+฿120 · tip ฿20 · ★★★★½").
 */
export function DropoffFx({ game, view }: OverlayProps) {
  const [items, setItems] = useState<Fx[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers = new Set<number>();
    const off = game.on('trip', (r: TripResult) => {
      const v = game.playerVehicle();
      const el = root.current;
      if (!v || r.vehicleId !== v.id || !el) return;
      const box = el.getBoundingClientRect();
      const pose = game.vehiclePose(v);
      const at = view?.screenPoint?.(pose.x, pose.y, 3) ?? null;
      const onScreen = !!at && at.x > 0 && at.y > 0 && at.x < box.width && at.y < box.height;
      const x = onScreen ? at!.x : box.width / 2;
      const y = onScreen ? at!.y : box.height * 0.55;
      const fx: Fx = {
        id: nextId++,
        x,
        y,
        text: `+${baht(r.fare)}${r.tip ? ` · tip ${baht(r.tip)}` : ''} · ${stars(r.rating)}`,
        stars: stars(r.rating),
      };
      setItems((list) => [...list.slice(-3), fx]);
      const t = window.setTimeout(() => {
        timers.delete(t);
        setItems((list) => list.filter((f) => f.id !== fx.id));
      }, FX_MS);
      timers.add(t);
      flyCoins(el, box, x, y, coinCount(r.fare, r.tip));
    });
    return () => {
      off();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [game, view]);

  return (
    <div className="dropoff-fx" ref={root} aria-hidden>
      {items.map((f) => (
        <div key={f.id} className="dropoff-item" style={{ left: f.x, top: f.y }}>
          <div className="dropoff-stars">
            {[...f.stars].map((s, i) => (
              <span key={i} style={{ animationDelay: `${120 + i * 90}ms` }}>
                {s}
              </span>
            ))}
          </div>
          <div className="dropoff-text">{f.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Animate coins from (x, y) in the overlay to the top bar's cash counter, then give the counter a bump. */
function flyCoins(layer: HTMLElement, box: DOMRect, x: number, y: number, n: number): void {
  const cash = document.querySelector('.topbar .stat.cash');
  if (!cash || typeof layer.animate !== 'function') return;
  const c = cash.getBoundingClientRect();
  const tx = c.left + c.width / 2 - box.left;
  const ty = c.top + c.height / 2 - box.top;
  let landed = 0;
  for (let i = 0; i < n; i++) {
    const coin = document.createElement('div');
    coin.className = 'dropoff-coin';
    coin.textContent = '฿';
    layer.appendChild(coin);
    const spread = (i - (n - 1) / 2) * 14;
    const anim = coin.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(0.5)`, opacity: 0 },
        { transform: `translate(${x + spread}px, ${y - 46 - (i % 3) * 8}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.7)`, opacity: 0.95 },
      ],
      { duration: 950, delay: i * 70, easing: 'cubic-bezier(0.45, 0, 0.75, 0.55)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      coin.remove();
      if (++landed === 1) {
        cash.classList.remove('cash-bump');
        void (cash as HTMLElement).offsetWidth;
        cash.classList.add('cash-bump');
      }
    };
  }
}
