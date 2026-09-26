// The simulation's candidate spots for the static city build to settle
// (build/anchors.ts): every signalled approach's traffic light and every
// place's waiting passenger, packed for the build worker.

import type { World } from '../data/world';
import { kerbCandidates } from '../sim/manual';
import { signalMap } from '../sim/signals';
import { KERB_FLOATS, SPOT_FLOATS, type AnchorList, type SimAnchors } from './build/anchors';
import { packSpot, signalCandidates } from './signalSpots';

/** Pack per-item candidate lists into CSR form. */
function pack<T>(items: T[][], floats: number, write: (out: Float32Array, i: number, spot: T) => void): AnchorList {
  const start = new Int32Array(items.length + 1);
  items.forEach((list, k) => (start[k + 1] = start[k] + list.length));
  const spots = new Float32Array(start[items.length] * floats);
  items.forEach((list, k) => list.forEach((spot, j) => write(spots, start[k] + j, spot)));
  return { start, spots };
}

/** Candidate spots for the traffic lights (one item per signalMap approach, in order) and the waiting passengers (one per place index). */
export function simAnchors(world: World): SimAnchors {
  const graph = world.graph;
  const signals = pack(
    signalMap(graph).approaches.map((arc) => signalCandidates(graph, arc)),
    SPOT_FLOATS,
    packSpot,
  );
  const kerbs = pack(
    world.places.map((place) => (place.offmap ? [] : kerbCandidates(graph, place))),
    KERB_FLOATS,
    (out, i, k) => {
      out[i * KERB_FLOATS] = k.x;
      out[i * KERB_FLOATS + 1] = k.y;
      out[i * KERB_FLOATS + 2] = k.face;
    },
  );
  return { signals, kerbs };
}
