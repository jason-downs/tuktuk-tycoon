// Web Worker: fetches city3d.json and generates the static world meshes off
// the main thread, settling the simulation's anchors (traffic lights, waiting
// passengers) against them, and transfers the typed arrays back.
import type { CityData } from '../city';
import type { SimAnchors } from './anchors';
import { buildCity, LAYERS, tileCity } from './world';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ url: string; anchors?: SimAnchors }>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  try {
    const res = await fetch(e.data.url);
    if (!res.ok) throw new Error(`${e.data.url}: HTTP ${res.status}`);
    const city = (await res.json()) as CityData;
    const built = tileCity(buildCity(city, e.data.anchors));
    const transfer: Transferable[] = [built.trees.buffer, built.signals.buffer, built.kerbs.buffer, ...Object.values(built.props).map((a) => a.buffer)];
    for (const id of LAYERS) {
      for (const m of built.layers[id]) transfer.push(m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer);
    }
    for (const index of built.farBuildings) transfer.push(index.buffer);
    scope.postMessage({ ok: true, built, play: city.play, keep: city.keep }, transfer);
  } catch (err) {
    scope.postMessage({ ok: false, error: String(err) }, []);
  }
};
