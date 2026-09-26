import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { manualControl, setAutodrive, whoDrives } from '../src/sim/manual';
import { installSystems } from '../src/sim/systems';
import type { Place } from '../src/sim/types';
import { driveKeyDown, gameKeyDown, toggleWheel } from '../src/ui/drive/DriveKeys';
import { focusNavActive, noteFocusIn, noteKeyDown, notePointerDown, onFocusedControl } from '../src/ui/focusNav';
import { manualKeyDown } from '../src/ui/manual/ManualDrive';
import { applyMode, canPanWithKeys, sendPlayerTo, sendPlayerToRefuel } from '../src/ui/mode';
import { ui } from '../src/ui/store';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

function newGame(seed = 7): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.requests = [];
  return game;
}

const BODY = { tagName: 'BODY', isContentEditable: false };
const BUTTON = { tagName: 'BUTTON', isContentEditable: false };

/** A key press as the window listeners see it. */
function key(k: string, opts: { shift?: boolean; target?: object } = {}) {
  const e = {
    key: k,
    shiftKey: !!opts.shift,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    target: opts.target ?? BODY,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
  };
  return e;
}
const asKey = (e: ReturnType<typeof key>) => e as unknown as KeyboardEvent;

/** Drive the game for `seconds` of game time in one-second steps. */
function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds; i++) game.step(1);
}

beforeEach(() => {
  ui.set({ modal: null, haggle: null, planner: false, panel: null, mode: 'drive', selectedRequest: null, selectedVehicle: null, selectedPlace: null });
  notePointerDown();
});

describe('a dialog on top owns the keyboard', () => {
  it('pause, speed, Esc, Tab and the driving keys do nothing under Help', () => {
    const game = newGame();
    applyMode(game, 'drive');
    game.setSpeed(2);
    ui.set({ panel: 'fleet', modal: 'help' });

    const space = key(' ');
    gameKeyDown(game, asKey(space));
    expect(game.state.speed).toBe(2);
    expect(space.defaultPrevented).toBe(false);
    gameKeyDown(game, asKey(key('4')));
    expect(game.state.speed).toBe(2);
    gameKeyDown(game, asKey(key('Escape')));
    expect(ui.get().panel).toBe('fleet');

    driveKeyDown(game, asKey(key('Tab')));
    expect(ui.get().mode).toBe('drive');

    // The GPS keeps the wheel while you scroll Help with the arrow keys.
    setAutodrive(game, true);
    const before = whoDrives(game);
    const down = key('ArrowDown');
    manualKeyDown(game, asKey(down));
    expect(whoDrives(game)).toBe(before);
    expect(manualControl(game).brake).toBe(false);
    expect(down.defaultPrevented).toBe(false);

    ui.set({ modal: null });
    manualKeyDown(game, asKey(key('ArrowDown')));
    expect(whoDrives(game)).toBe('hand');
  });

  it('Manage-mode arrow keys pan the camera only with no dialog open', () => {
    const game = newGame();
    applyMode(game, 'manage');
    expect(canPanWithKeys(game)).toBe(true);
    ui.set({ modal: 'help' });
    expect(canPanWithKeys(game)).toBe(false);
  });
});

describe('keyboard focus navigation', () => {
  it('Tab switches mode until Shift+Tab moves focus, then Tab and Enter work the controls', () => {
    const game = newGame();
    applyMode(game, 'drive');

    // Tab on the map: the mode key.
    const tab = key('Tab');
    noteKeyDown(tab, 0);
    driveKeyDown(game, asKey(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(ui.get().mode).toBe('manage');
    // The prevented Tab moved no focus, so a later focus change is not keyboard navigation.
    noteFocusIn(10);
    expect(focusNavActive()).toBe(false);

    // Shift+Tab moves focus and is never the mode key.
    const back = key('Tab', { shift: true });
    noteKeyDown(key('Shift'), 100);
    noteKeyDown(back, 101);
    driveKeyDown(game, asKey(back));
    expect(back.defaultPrevented).toBe(false);
    expect(ui.get().mode).toBe('manage');
    noteFocusIn(102);
    expect(focusNavActive()).toBe(true);

    // Now Tab moves focus on.
    const next = key('Tab', { target: BUTTON });
    noteKeyDown(next, 200);
    driveKeyDown(game, asKey(next));
    expect(next.defaultPrevented).toBe(false);
    expect(ui.get().mode).toBe('manage');
    noteFocusIn(201);

    // Enter and Space press the focused button and are not game keys.
    applyMode(game, 'drive');
    const notices = game.state.notices.length;
    const enter = key('Enter', { target: BUTTON });
    noteKeyDown(enter, 300);
    driveKeyDown(game, asKey(enter));
    expect(enter.defaultPrevented).toBe(false);
    expect(game.state.notices.length).toBe(notices);
    game.setSpeed(2);
    const space = key(' ', { target: BUTTON });
    gameKeyDown(game, asKey(space));
    expect(space.defaultPrevented).toBe(false);
    expect(game.state.speed).toBe(2);
    expect(onFocusedControl({ target: BODY as unknown as EventTarget })).toBe(false);

    // A click hands the keys back to the game.
    notePointerDown();
    const again = key('Tab', { target: BUTTON });
    driveKeyDown(game, asKey(again));
    expect(again.defaultPrevented).toBe(true);
    expect(ui.get().mode).toBe('manage');
  });

  it('Esc ends keyboard navigation too', () => {
    noteKeyDown(key('Tab'), 0);
    noteFocusIn(5);
    expect(focusNavActive()).toBe(true);
    noteKeyDown(key('Escape'), 10);
    expect(focusNavActive()).toBe(false);
  });
});

describe('sending your tuk-tuk from the UI', () => {
  it('⛽ Refuel and a right-click on the city map hand the wheel to the GPS in Drive mode', () => {
    const game = newGame(3);
    applyMode(game, 'drive');
    expect(whoDrives(game)).toBe('hand');
    const v = game.playerVehicle()!;
    const start = game.vehiclePose(v);
    expect(sendPlayerToRefuel(game)).toBe(true);
    expect(whoDrives(game)).toBe('gps');
    run(game, 120);
    const now = game.vehiclePose(v);
    expect(Math.hypot(now.x - start.x, now.y - start.y)).toBeGreaterThan(50);

    const other = newGame(3);
    applyMode(other, 'drive');
    const temple = landmark('wat_chedi_luang');
    expect(sendPlayerTo(other, temple.x, temple.y)).toBe(true);
    expect(whoDrives(other)).toBe('gps');
    expect(other.state.notices.at(-1)?.text).toBe('Heading there.');
  });

  it('in Manage mode autopilot keeps driving', () => {
    const game = newGame(3);
    applyMode(game, 'manage');
    expect(sendPlayerToRefuel(game)).toBe(true);
    expect(manualControl(game).on).toBe(false);
    expect(game.state.autopilot).toBe(true);
  });
});

describe('the 🕹️ Drive button', () => {
  it('takes the wheel through Drive mode, and in Drive works like G', () => {
    const game = newGame();
    applyMode(game, 'manage');
    toggleWheel(game);
    expect(ui.get().mode).toBe('drive');
    expect(whoDrives(game)).toBe('hand');

    // Handing the wheel over with nowhere to go gives it to autopilot, never an idle GPS.
    toggleWheel(game);
    expect(whoDrives(game)).toBe('autopilot');
    toggleWheel(game);
    expect(whoDrives(game)).toBe('hand');

    const req = makeRequest(game, landmark('tha_phae_gate'), landmark('wat_chedi_luang'), 'tourist_west', 'street', calendar(game.state.time));
    game.state.requests.push(req);
    expect(game.playerClaim(req.id)).toBe(true);
    toggleWheel(game);
    expect(whoDrives(game)).toBe('gps');
  });
});
