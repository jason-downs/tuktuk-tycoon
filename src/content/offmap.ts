// Out-of-town destinations reached through a portal at the edge of the play
// area (scripts/build-map.mjs computes the road distance beyond the edge).
// Round trips wait for the passenger and drive them back into town.

export interface OffmapTrip {
  /** The tuk-tuk waits and brings the passenger back. */
  roundTrip?: boolean;
  /** Minutes the passenger spends there on a round trip. */
  waitMin?: number;
  /** Agreed fare for a round trip, THB. */
  fare?: number;
}

export const OFFMAP_TRIPS: Record<string, OffmapTrip> = {
  // [research] economics.md trip catalogue: Doi Suthep "400 return" once a tuk-tuk can climb.
  wat_doi_suthep: { roundTrip: true, waitMin: 60, fare: 400 },
  bhubing_palace: { roundTrip: true, waitMin: 75, fare: 550 },
  wat_pha_lat: { roundTrip: true, waitMin: 45, fare: 300 },
  // [pacing] half-day outings priced like the temple-loop charter (economics.md: 600 half day).
  grand_canyon: { roundTrip: true, waitMin: 120, fare: 600 },
  night_safari: { roundTrip: true, waitMin: 150, fare: 600 },
};

/** Out-of-town driving speed (open roads) and climbing speed, km/h [pacing]. */
export const OFFMAP_KMH = 32;
export const CLIMB_KMH = 18;
/** Share of destination demand an out-of-town place gets compared with an in-town one [pacing]. */
export const OFFMAP_DEST_WEIGHT = 0.6;
