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
  [['Tab'], 'Drive ↔ Manage'],
  [['Shift', 'Tab'], 'Move keyboard focus through the buttons; then Tab moves on and Enter presses. Esc or a click hands the keys back'],
  [['W', '↑'], 'Drive: throttle (hold); takes the wheel back from the GPS'],
  [['S', '↓'], 'Drive: brake (hold); pressed and held at a standstill, U-turn on a two-way road'],
  [['A', '←', 'D', '→'], 'Drive: turn left / right at the next junction'],
  [['E', 'Enter'], 'Drive: pick up the passenger beside you, or fill up at a pump'],
  [['G'], 'Drive: the GPS drives (or finds passengers) / take the wheel back'],
  [['H'], 'Drive: horn — nearby passengers wave'],
  [['W', 'A', 'S', 'D'], 'Manage: pan the camera'],
  [['Space'], 'Pause / resume'],
  [['1', '2', '3', '4', '5'], 'Manage: speed ½× · 1× · 2× · 4× · 8×'],
  [['M'], 'City map planner on / off'],
  [['F'], 'Manage: follow your tuk-tuk with the camera'],
  [['Esc'], 'Close cards, panels, the city map and this help'],
  [['?'], 'Open this help'],
];

const MOUSE: [string, string][] = [
  ['Click a waving passenger', 'See their trip, then Pick up (the GPS drives you there) or dispatch a free tuk-tuk'],
  ['Right-click the map or minimap', 'Drive there (right-click a ⛽ pump to refuel)'],
  ['Click a tuk-tuk', 'Select it; in Manage the camera follows it'],
  ['Click a landmark', 'Read about the place'],
  ['Drag · scroll or pinch', 'Drive: look around and zoom. Manage: pan and zoom'],
  ['Click the overview map', 'Manage: fly the camera there'],
  ['Click a place name or a notice', 'Show it: Drive looks there for a few seconds (W, S or 🎯 comes back sooner); Manage flies the camera there'],
];

/** "How to play": controls, the ride loop, haggling, growing a fleet, tips and credits. */
export function HelpModal({ game }: OverlayProps) {
  const open = useUI((s) => s.modal === 'help');

  // Its keys (? and Esc) go through the game's key listener (drive/DriveKeys.ts helpKeyDown).
  if (!open) return null;
  const close = () => ui.set({ modal: null });
  const panels = PANELS.map((p) => `${p.icon} ${p.title}`).join(' · ');

  return (
    <div className="modal-backdrop help-backdrop" onClick={close}>
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
                <b>Pick them up.</b> Stop beside one and press <kbd>E</kbd>, or click one, read where they’re going and press{' '}
                <i>Pick up</i>. The pink line is your GPS route.
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
              In <b>Drive</b> mode you steer your own tuk-tuk: hold throttle and brake, and tap left or right to choose the
              next junction. You can push to {Math.round(MANUAL_SPEED_BONUS * 100)}% of the road speed — thrill-seekers love
              it, elders and retirees don’t. Stop beside a waving passenger and press <kbd>E</kbd>. The clock slows to street
              pace while you steer and runs at 1× while you’re parked or the GPS drives (<kbd>G</kbd>). Traffic lights stop
              the traffic; running a red by hand upsets passengers and sometimes earns a police fine. In <b>Manage</b> mode
              (<kbd>Tab</kbd>) your tuk-tuk runs on autopilot, finding and haggling fares by itself, and the speed buttons
              run the clock.
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
            <p>
              An LPG tuk-tuk can’t haul passengers up Doi Suthep. Fit a mountain rebuild at the Garage, or convert it to
              electric, to take those fares. Lung Daeng won’t let you drill holes in his rented tuk-tuk, so only small
              extras go on that one.
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
