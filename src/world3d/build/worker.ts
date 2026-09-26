// Web Worker: fetches city3d.json and generates the static world meshes off
// the main thread, transferring the typed arrays back.
import type { CityData } from '../city';
import { buildCity, LAYERS, tileCity } from './world';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ url: string }>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  try {
    const res = await fetch(e.data.url);
    if (!res.ok) throw new Error(`${e.data.url}: HTTP ${res.status}`);
    const city = (await res.json()) as CityData;
    const built = tileCity(buildCity(city));
    const transfer: Transferable[] = [built.trees.buffer, ...Object.values(built.props).map((a) => a.buffer)];
    for (const id of LAYERS) {
      for (const m of built.layers[id]) transfer.push(m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer);
    }
    scope.postMessage({ ok: true, built, play: city.play, keep: city.keep }, transfer);
  } catch (err) {
    scope.postMessage({ ok: false, error: String(err) }, []);
  }
};
