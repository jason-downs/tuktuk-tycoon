import { CLIMB_BLOCKED_TEXT, CLIMB_HELP_TEXT } from '../sim/mountain';
import { ui } from './store';
import './climb.css';

/** Why the player's tuk-tuk can't take a Doi Suthep ride, with a way to the garage. */
export function ClimbNotice() {
  return (
    <div className="climb-notice" role="note">
      <span className="climb-icon" aria-hidden>
        ⛰️
      </span>
      <div>
        <b>{CLIMB_BLOCKED_TEXT}</b> {CLIMB_HELP_TEXT}{' '}
        <button className="link" onClick={() => ui.set({ panel: 'garage' })}>
          Open the garage
        </button>
      </div>
    </div>
  );
}
