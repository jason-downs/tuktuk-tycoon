import { useEffect } from 'react';
import { rainIntensity } from '../../audio/rain';
import { sound } from '../../audio/sound';
import type { TripResult } from '../../sim/dispatch';
import type { Notice } from '../../sim/types';
import type { OverlayProps } from '../overlays';
import { ui } from '../store';

/** Seconds between rain checks. */
const RAIN_POLL = 0.5;

/**
 * Plays the game's sounds from its events: the putter while your tuk-tuk moves
 * under the camera, the horn when you reach a passenger, coins when you are
 * paid, a tick for goal and event notices, and rain from the weather system.
 */
export function AudioDirector({ game }: OverlayProps) {
  useEffect(() => sound.installUnlock(), []);

  useEffect(() => {
    let lastTask = game.playerVehicle()?.task.kind ?? 'idle';
    let sinceRain = RAIN_POLL;
    const offFrame = game.on('frame', (dt: number) => {
      const v = game.playerVehicle();
      const s = ui.get();
      const following = s.follow && s.selectedVehicle === null;
      const moving = !!v && v.speed > 0.4;
      sound.setEngine(moving && following && !game.isPaused(), v?.speed ?? 0);
      const task = v?.task.kind ?? 'idle';
      // Arriving at a waiting passenger: the street haggle or an app booking boarding straight away.
      if (lastTask === 'pickup' && (task === 'haggle' || task === 'trip')) sound.horn();
      lastTask = task;
      sinceRain += dt;
      if (sinceRain >= RAIN_POLL) {
        sinceRain = 0;
        sound.setRain(rainIntensity(game));
      }
    });
    const offTrip = game.on('trip', (r: TripResult) => {
      if (r.vehicleId === game.playerVehicle()?.id) sound.coins(r.tip > 0);
    });
    const offNotice = game.on('notice', (n: Notice) => {
      if (n.kind === 'goal' || n.kind === 'event') sound.tick(n.kind);
    });
    return () => {
      offFrame();
      offTrip();
      offNotice();
      sound.setEngine(false, 0);
      sound.setRain(0);
    };
  }, [game]);

  return null;
}
