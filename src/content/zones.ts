// Operating zones a fleet driver can be told to work. Centres are OSM
// coordinates from docs/research/landmarks.md / calendar.md §7.

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  blurb: string;
}

export const ZONES: Zone[] = [
  { id: 'old_city', name: 'Old City', lat: 18.78716, lon: 98.98645, radius: 1_150, blurb: 'Temples, hostels and the moat loop.' },
  { id: 'tha_phae', name: 'Tha Phae & Night Bazaar', lat: 18.7865, lon: 98.9985, radius: 900, blurb: 'The busiest rank in town, day and night.' },
  { id: 'nimman', name: 'Nimman & Maya', lat: 18.799, lon: 98.967, radius: 1_000, blurb: 'Cafés, co-working and nightlife.' },
  { id: 'riverside', name: 'Riverside & Wat Ket', lat: 18.7915, lon: 99.0055, radius: 900, blurb: 'Warorot market, riverside dining, retirees.' },
  { id: 'airport', name: 'Airport & Central', lat: 18.7668, lon: 98.9665, radius: 1_300, blurb: 'CNX arrivals and the Central Airport mall.' },
  { id: 'chang_phueak', name: 'Chang Phueak', lat: 18.806, lon: 98.985, radius: 1_200, blurb: 'Bus station, night market, locals.' },
  { id: 'cmu', name: 'CMU & Huay Kaew', lat: 18.8035, lon: 98.953, radius: 1_300, blurb: 'Students, the zoo and the road up Doi Suthep.' },
  { id: 'arcade', name: 'Arcade & Central Festival', lat: 18.8, lon: 99.017, radius: 1_400, blurb: 'Long-distance buses and the big mall.' },
];
