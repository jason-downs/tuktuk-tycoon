import { useEffect } from 'react';
import { TIPS } from '../../content/tips';
import { BALANCE } from '../../sim/balance';
import { MANUAL_SPEED_BONUS } from '../../sim/manual';
import { tutorialSignal } from '../../sim/tutorial';
import type { OverlayProps } from '../overlays';
import { PANELS } from '../panels';
import { GlossedText } from '../SpeechLine';
import { ui, useUI } from '../store';
import './help.css';

const KEYS: [string[], string][] = [
  [['Space'], 'Pause / resume'],
  [['1', '2', '3', '4', '5'], 'Speed ½× · 1× · 2× · 4× · 8×'],
  [['F'], 'Follow your tuk-tuk with the camera'],
  [['M'], 'Manual driving on / off'],
  [['W', '↑'], 'Manual: throttle (hold)'],
  [['S', '↓'], 'Manual: brake (hold)'],
  [['A', '←', 'D', '→'], 'Manual: turn left / right at the next junction'],
  [['Esc'], 'Close cards, panels and this help'],
  [['?'], 'Open this help'],
];

const MOUSE: [string, string][] = [
  ['Click a waving passenger', 'See their trip, then press Pick up'],
  ['Right-click the map', 'Drive there (right-click a ⛽ pump to refuel)'],
  ['Click a tuk-tuk', 'Select and follow it'],
  ['Click a landmark', 'Read about the place'],
  ['Drag · scroll · pinch', 'Pan and zoom the map'],
];

/** "How to play": controls, the ride loop, haggling, growing a fleet, tips and credits. */
export function HelpModal({ game }: OverlayProps) {
  const open = useUI((s) => s.modal === 'help');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '?') {
        ui.set((s) => ({ modal: s.modal === 'help' ? null : 'help' }));
      } else if (e.key === 'Escape' && ui.get().modal === 'help') {
        ui.set({ modal: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  const close = () => ui.set({ modal: null });
  const panels = PANELS.map((p) => `${p.icon} ${p.title}`).join(' · ');

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="dialog help" role="dialog" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>How to play</h2>
          <button className="btn tiny" onClick={close} aria-label="Close help">
            ✕
          </button>
        </div>
        <div className="help-body">
          <section>
            <h3>The ride</h3>
            <ol className="help-steps">
              <li>
                <b>Find a passenger.</b> People waving on the map want a ride; the ring shows how long they’ll wait.
              </li>
              <li>
                <b>Pick them up.</b> Click one, read where they’re going, press <i>Pick up</i>. The pink line is your GPS route.
              </li>
              <li>
                <b>Haggle.</b> At the kerb you name a price, then drive them to the pin.
              </li>
              <li>
                <b>Get paid and rated.</b> The fare, maybe a tip, and a star rating arrive at the drop-off.
              </li>
            </ol>
          </section>

          <section>
            <h3>Haggling</h3>
            <p>
              The <b>going rate</b> is a fair street fare (about ฿{BALANCE.fare.flag} plus ฿{BALANCE.fare.perKm} a km). Locals haggle
              down; tourists often accept more, and late at night near bars and markets they pay more still. If you ask too much
              the passenger counters once, then walks off. Overcharging earns more today but costs stars (★), and stars bring
              passengers back. Many drivers carry monks for free to make merit (<GlossedText text="tham bun" />).
            </p>
          </section>

          <section>
            <h3>Driving</h3>
            <p>
              Your tuk-tuk follows the GPS by itself. Press <kbd>M</kbd> (or 🕹️ on your card) to take the handlebars: hold
              throttle, brake, and tap left or right to choose the next junction. You can push to{' '}
              {Math.round(MANUAL_SPEED_BONUS * 100)}% of the road speed — thrill-seekers love it, elders and retirees don’t.
              Leave the route and the GPS re-plans from the next junction. <b>Autopilot</b> finds and haggles fares for you.
            </p>
            <p>
              Watch the LPG bar: refuel before it’s empty or you’ll crawl to the pump. Rent (฿{BALANCE.startRentPerDay}/day for
              Lung Daeng’s tuk-tuk), wages and upkeep are settled at 04:00.
            </p>
          </section>

          <section>
            <h3>Growing the business</h3>
            <p>
              Save up, rent or buy more tuk-tuks, hire drivers and give them shifts and zones. Upgrades and paint win better
              ratings; partnerships, permits and depots open new kinds of work. Your office: {panels}.
            </p>
          </section>

          <section className="help-controls">
            <h3>Controls</h3>
            <table>
              <tbody>
                {KEYS.map(([keys, what]) => (
                  <tr key={what}>
                    <td>
                      {keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
                {MOUSE.map(([how, what]) => (
                  <tr key={how}>
                    <td className="help-mouse">{how}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Local tips</h3>
            <ul className="help-tips">
              {TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="help-credits">
            <h3>Credits</h3>
            <p>
              Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL). Fares, costs,
              festivals, places, language and people come from the fact-checked research notes in <code>docs/research/</code>{' '}
              (economics, calendar, culture, landmarks); numbers chosen for pacing are marked as such in the code. Sounds are
              synthesised in your browser.
            </p>
          </section>
        </div>
        <div className="help-foot">
          <button
            className="btn"
            onClick={() => {
              tutorialSignal(game, { kind: 'restart' });
              close();
            }}
          >
            👴 Replay the tutorial
          </button>
          <button className="btn primary" onClick={close}>
            Back to the road
          </button>
        </div>
      </div>
    </div>
  );
}
