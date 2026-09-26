import { readFileSync } from 'node:fs';
import { RoadGraph, type GraphJSON } from '../src/sim/graph';

let cached: RoadGraph | null = null;

/** The real Chiang Mai road graph baked into public/data. */
export function loadGraph(): RoadGraph {
  if (!cached) {
    const json = JSON.parse(readFileSync(new URL('../public/data/graph.json', import.meta.url), 'utf8')) as GraphJSON;
    cached = new RoadGraph(json);
  }
  return cached;
}
