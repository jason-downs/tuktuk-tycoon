// Tunable game numbers. Values marked [research] come from
// docs/research/economics.md ("Suggested game numbers") or calendar.md; values
// marked [pacing] are chosen so a play session progresses at game speed rather
// than real-life speed (a real tuk-tuk takes more than a year to pay for itself).

export const BALANCE = {
  /** [research] a week of take-home pay. */
  startCash: 3_000,
  /** [research] daily rent for Lung Daeng's tired LPG tuk-tuk. */
  startRentPerDay: 350,
  /** Hour of day when rents, wages and daily upkeep are settled. */
  dayRolloverHour: 4,

  fare: {
    /** [research] street fare ≈ 40 + 18/km, rounded to 10 THB. */
    flag: 40,
    perKm: 18,
    min: 60,
    /**
     * [pacing] Added to a passenger's highest acceptable fare ratio for pickups at nightlife and markets from 22:00
     * to 04:00, which at the starting 4.2★ lets tourists take about 1.7–2.3×. Softer than the 2–3× late-night
     * tolerance in economics.md "Suggested game numbers", so late fares do not dominate a day's takings.
     */
    lateNightBonus: 0.5,
  },
  app: {
    /** [research] app job: 80 + 13/km fixed; platform keeps 20–25 %. */
    flag: 80,
    perKm: 13,
    platformCut: 0.2,
  },
  fuel: {
    /** [research] LPG ≈ 1.4 THB/km (14 THB/L ÷ ~10 km/L). */
    lpgPerKm: 1.4,
    /** [research] EV at home ≈ 0.35 THB/km: overnight charging at the company's own depots. */
    evHomePerKm: 0.35,
    /** [research] EV at a public DC charger ≈ 0.65 THB/km: the chargers at the big malls. */
    evPublicPerKm: 0.65,
    /** Range on a full tank, km. */
    tankKm: 160,
    /** Game seconds to fill up. */
    refuelSeconds: 6 * 60,
  },
  upkeep: {
    /** [research] maintenance per day in service. */
    lpgPerDay: 55,
    evPerDay: 15,
    /** [research] insurance + tax ≈ 615/yr. */
    insurancePerDay: 2,
    /** Condition points lost per km driven. */
    wearPerKm: 0.05,
  },
  demand: {
    /** Street hails per game hour citywide at a 1.0 hourly/season factor. */
    streetPerHour: 150,
    /** Metres around a fleet tuk-tuk inside which street hails are visible. */
    sightRadius: 1_200,
    /** Game seconds a street passenger waits before giving up. */
    patienceMin: 10 * 60,
    patienceMax: 28 * 60,
    /** Trips shorter than this are walked. */
    minTripMetres: 700,
    /** Typical tuk-tuk trip length (peak of the distance kernel). */
    typicalTripMetres: 3_200,
  },
  trip: {
    /** Game seconds to load/unload passengers. */
    boardSeconds: 60,
    alightSeconds: 45,
    /** Road distance ≈ straight line × detour factor (estimate before routing). */
    detourFactor: 1.3,
  },
  rating: {
    start: 4.2,
    /** Ratings kept for the rolling reputation average. */
    window: 60,
  },
} as const;

export function roundFare(v: number): number {
  return Math.max(10, Math.round(v / 10) * 10);
}

export function streetFare(metres: number): number {
  const { flag, perKm, min } = BALANCE.fare;
  return Math.max(min, roundFare(flag + (perKm * metres) / 1000));
}

export function appFare(metres: number): number {
  return roundFare(BALANCE.app.flag + (BALANCE.app.perKm * metres) / 1000);
}
