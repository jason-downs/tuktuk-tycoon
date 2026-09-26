// Carriageway width of an OSM highway way. The routing graph (build-map.mjs)
// and the 3D city (build-city3d.mjs) both use it, so traffic keeps to the
// lanes of the roads the 3D view draws.

/** Carriageway width when neither width nor lanes is tagged, metres, by road class. */
export const DEFAULT_WIDTH = [14, 12, 10, 8, 6.5, 5.5, 4.5, 4];
/** Lane width by road class, metres. */
export const LANE_WIDTH = [3.25, 3.25, 3.0, 3.0, 2.75, 2.75, 2.75, 2.75];

/** Width (m): a plausible width tag, else lanes × lane width + 0.6 m, else the class default. */
export function carriagewayWidth(tags, cls, lanes) {
  const width = parseFloat(tags.width);
  if (width > 1.5 && width < 40) return width;
  return lanes ? lanes * LANE_WIDTH[cls] + 0.6 : DEFAULT_WIDTH[cls];
}
