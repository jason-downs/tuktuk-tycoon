// Operating zones a fleet driver can be told to work, all inside the play
// area. Centres are OSM coordinates from docs/research/landmarks.md and
// calendar.md §7.

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  blurb: string;
}

export const ZONES: Zone[] = [
  { id: 'old_city', name: 'Old City', lat: 18.7875, lon: 98.986, radius: 1_050, blurb: 'Temples, hostels and the one-way moat loop.' },
  { id: 'tha_phae', name: 'Tha Phae & Night Bazaar', lat: 18.7855, lon: 98.999, radius: 700, blurb: 'The busiest rank in town, day and night.' },
  { id: 'riverside', name: 'Riverside, Warorot & Wat Ket', lat: 18.7915, lon: 99.0045, radius: 700, blurb: 'Warorot market, riverside dining, retirees.' },
  { id: 'nimman', name: 'Nimman & Maya', lat: 18.7985, lon: 98.968, radius: 800, blurb: 'Cafés, co-working and nightlife.' },
  { id: 'wualai', name: 'Wua Lai & Chiang Mai Gate', lat: 18.779, lon: 98.987, radius: 700, blurb: 'Silver street, the Saturday market and the gate’s food stalls.' },
  { id: 'airport', name: 'Airport & Central Airport Plaza', lat: 18.769, lon: 98.971, radius: 900, blurb: 'CNX arrivals and the big mall.' },
  { id: 'chang_phueak', name: 'Chang Phueak & Jing Jai', lat: 18.802, lon: 98.988, radius: 800, blurb: 'Bus station, night market, locals.' },
  { id: 'cmu', name: 'Suthep Rd & CMU gate', lat: 18.796, lon: 98.958, radius: 900, blurb: 'Students, Wat Suan Dok and the road towards Doi Suthep.' },
  { id: 'arcade', name: 'Arcade, Central Festival & the station', lat: 18.795, lon: 99.016, radius: 1_000, blurb: 'Long-distance buses, trains and the big mall.' },
];
