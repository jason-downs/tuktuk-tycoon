// Tuk-tuk liveries, from docs/research/culture.md §11d (grounded in Wikimedia
// Commons photos of Chiang Mai tuk-tuks and local motifs).

export interface Paint {
  id: string;
  name: string;
  body: string;
  canopy: string;
  trim: string;
  price: number;
  /** Small rating bonus from a crowd-pleasing look. */
  comfort: number;
  blurb: string;
}

export const PAINTS: Record<string, Paint> = {
  nakhon_blue: { id: 'nakhon_blue', name: 'Nakhon Blue', body: '#1f4fa8', canopy: '#1b1b1f', trim: '#e8b923', price: 0, comfort: 0, blurb: 'The classic Chiang Mai look: royal blue, gold pinstripe, red rims.' },
  rot_daeng: { id: 'rot_daeng', name: 'Rot Daeng', body: '#c8312b', canopy: '#2a1a18', trim: '#f4efe6', price: 2_500, comfort: 0.02, blurb: 'Songthaew red with white lettering — a nod to the red trucks.' },
  bo_sang: { id: 'bo_sang', name: 'Bo Sang Parasol', body: '#efe3c4', canopy: '#b0492f', trim: '#d9534f', price: 4_500, comfort: 0.06, blurb: 'Cream saa-paper panels with hand-painted flowers.' },
  khom_loi: { id: 'khom_loi', name: 'Khom Loi Night', body: '#1a2146', canopy: '#0d1024', trim: '#ffb347', price: 6_000, comfort: 0.08, blurb: 'Midnight blue with warm lantern-glow LED strips.' },
  kalae_teak: { id: 'kalae_teak', name: 'Kalae Teak', body: '#8a5a2b', canopy: '#3b2414', trim: '#d9a441', price: 5_500, comfort: 0.06, blurb: 'Teak wood-grain panels and crossed kalae horns.' },
  wua_lai: { id: 'wua_lai', name: 'Wua Lai Silver', body: '#b9bcc2', canopy: '#4a4d55', trim: '#eef0f3', price: 7_000, comfort: 0.08, blurb: 'Hammered silver panels inspired by Wat Sri Suphan.' },
  chang_phueak: { id: 'chang_phueak', name: 'White Elephant', body: '#f5f3ee', canopy: '#8b6b2e', trim: '#d4a017', price: 6_500, comfort: 0.07, blurb: 'White body, gold trim, elephant motifs.' },
  khao_soi: { id: 'khao_soi', name: 'Khao Soi Gold', body: '#e3a21a', canopy: '#5a3b0e', trim: '#8bc34a', price: 3_500, comfort: 0.04, blurb: 'Turmeric-curry yellow with a lime-green trim.' },
  tung_lanna: { id: 'tung_lanna', name: 'Tung Lanna', body: '#7b2d8b', canopy: '#2b0f33', trim: '#f2c14e', price: 5_000, comfort: 0.06, blurb: 'Lanna tung flags and hanging lanterns along the canopy.' },
  ev_green: { id: 'ev_green', name: 'EV Green', body: '#2f9e5b', canopy: '#16301f', trim: '#c7f0d4', price: 3_000, comfort: 0.03, blurb: 'Eco green for the silent electric fleet.' },
  coop_taxi: { id: 'coop_taxi', name: 'Cooperative Taxi', body: '#f2c418', canopy: '#1f4fa8', trim: '#1f4fa8', price: 2_000, comfort: 0.02, blurb: 'The yellow-blue split of Chiang Mai’s cooperative taxis.' },
};
