// Driver roster for the hiring pool: the 40 names and hooks of
// docs/research/culture.md §11b. Full names are synthesised from ordinary Thai
// name elements (culture.md §6). `lean` nudges the random 0–100 skills so each
// applicant plays like their hook; `shift` and `zone` are the hook's natural fit.

export type DriverSkill = 'driving' | 'english' | 'charm' | 'honesty' | 'stamina';

export interface RosterDriver {
  nickname: string;
  fullName: string;
  gender: 'M' | 'F';
  hook: string;
  /** Offsets added to the random base skills (−20 … +20). */
  lean: Partial<Record<DriverSkill, number>>;
  shift?: 'day' | 'night' | 'long';
  /** Zone id from src/content/zones.ts. */
  zone?: string;
}

export const DRIVER_ROSTER: RosterDriver[] = [
  { nickname: 'Lek', fullName: 'Somchai Kaewkhamma', gender: 'M', hook: '“Small” — a veteran of the Tha Phae Gate rank.', lean: { driving: 20, english: 5, stamina: -5 }, zone: 'tha_phae' },
  { nickname: 'Daeng', fullName: 'Wichai Inthawong', gender: 'M', hook: '“Red” — loves the red-rim livery.', lean: { charm: 5 } },
  { nickname: 'Moo', fullName: 'Sombat Jaikaew', gender: 'M', hook: '“Pig” — a nickname to fool the spirits.', lean: { charm: 5, honesty: 5 } },
  { nickname: 'Gai', fullName: 'Boonmee Saengthong', gender: 'M', hook: '“Chicken” — early riser for the market runs.', lean: { stamina: 15 }, shift: 'day', zone: 'riverside' },
  { nickname: 'Uan', fullName: 'Narong Khamsaen', gender: 'M', hook: '“Chubby” — knows every khao soi stall.', lean: { charm: 15, stamina: -10 } },
  { nickname: 'Thong', fullName: 'Anan Panyadee', gender: 'M', hook: '“Gold” — collects lucky banknotes.', lean: { charm: 5, honesty: -10 } },
  { nickname: 'Bank', fullName: 'Thanakorn Moonsri', gender: 'M', hook: 'Good with fares. Very good with fares.', lean: { english: 5, honesty: -8 } },
  { nickname: 'Ball', fullName: 'Kittisak Chaiya-in', gender: 'M', hook: 'Football fan; the radio is always on the match.', lean: { stamina: 10 } },
  { nickname: 'Beer', fullName: 'Nattapong Kaewprasert', gender: 'M', hook: 'Night-shift regular on Loi Kroh Road.', lean: { english: 10, honesty: -10 }, shift: 'night', zone: 'tha_phae' },
  { nickname: 'New', fullName: 'Phuwadon Inkham', gender: 'M', hook: 'Young rookie, keen to learn.', lean: { driving: -20, english: 10, stamina: 15 } },
  { nickname: 'Ice', fullName: 'Pongsak Srikham', gender: 'M', hook: 'Never loses his jai yen.', lean: { charm: 10, honesty: 10 } },
  { nickname: 'Benz', fullName: 'Thawatchai Jaiwong', gender: 'M', hook: 'Dreams of driving an EV tuk-tuk.', lean: { driving: 5 } },
  { nickname: 'Porsche', fullName: 'Chatchai Kantha', gender: 'M', hook: 'Flashy; wants LED lights on everything.', lean: { driving: 10, charm: 5, honesty: -10 } },
  { nickname: 'Gop', fullName: 'Surachai Inta', gender: 'M', hook: '“Frog” — jumps the gaps in traffic.', lean: { driving: 15, charm: -10 } },
  { nickname: 'Mah', fullName: 'Sakda Thongkham', gender: 'M', hook: '“Dog” — loyal to his regulars.', lean: { honesty: 15 } },
  { nickname: 'Yai', fullName: 'Anurak Kaewsaen', gender: 'M', hook: '“Big” — hauls the vendors’ loads.', lean: { stamina: 20, english: -10 } },
  { nickname: 'Noi', fullName: 'Prasert Ruangsri', gender: 'M', hook: 'Pedalled a samlor before the engines came.', lean: { stamina: 15, driving: 5, english: -15 } },
  { nickname: 'Google', fullName: 'Kritsada Panyakham', gender: 'M', hook: 'Knows every soi without a map.', lean: { driving: 20 } },
  { nickname: 'Golf', fullName: 'Wirat Somkhid', gender: 'M', hook: 'Golf-course shuttle specialist.', lean: { english: 15 } },
  { nickname: 'Pong', fullName: 'Chaiwat Suriya', gender: 'M', hook: 'A Wat Ket riverside regular.', lean: { charm: 5 }, zone: 'riverside' },
  { nickname: 'Aod', fullName: 'Sompong Maneewong', gender: 'M', hook: 'Chatty; speaks some Korean.', lean: { english: 15, charm: 10 } },
  { nickname: 'Tee', fullName: 'Ekkachai Duangkaew', gender: 'M', hook: 'Superhighway speedster.', lean: { driving: 10, charm: -10 }, zone: 'arcade' },
  { nickname: 'Oy', fullName: 'Supattra Inkaew', gender: 'F', hook: 'Runs the Warorot rank roster.', lean: { driving: 10, honesty: 10 }, zone: 'riverside' },
  { nickname: 'Ya', fullName: 'Kanokwan Sriboonruang', gender: 'F', hook: 'First to try the Doi Suthep climb.', lean: { driving: 15, english: 10 }, zone: 'cmu' },
  { nickname: 'Nok', fullName: 'Malee Kaewta', gender: 'F', hook: '“Bird” — dawn market runs.', lean: { stamina: 10 }, shift: 'day' },
  { nickname: 'May', fullName: 'Wanida Khamphan', gender: 'F', hook: 'Born in May, cheerful all year.', lean: { charm: 15 } },
  { nickname: 'Ploy', fullName: 'Ratchanee Suwan', gender: 'F', hook: '“Gem” — wary of gem-shop touts.', lean: { honesty: 20 } },
  { nickname: 'Nan', fullName: 'Jintana Thiprat', gender: 'F', hook: 'Works the Nimman café circuit.', lean: { english: 15 }, zone: 'nimman' },
  { nickname: 'Nahm', fullName: 'Pornthip Saengjan', gender: 'F', hook: '“Water” — the Songkran queen.', lean: { charm: 10, stamina: 5 } },
  { nickname: 'Fah', fullName: 'Duangjai Inthasuk', gender: 'F', hook: '“Sky” — a Doi Suthep specialist.', lean: { driving: 15 }, zone: 'cmu' },
  { nickname: 'Bua', fullName: 'Buakham Kanthasri', gender: 'F', hook: '“Lotus” — the elders’ favourite on temple days.', lean: { honesty: 15, charm: 10, english: -10 }, zone: 'old_city' },
  { nickname: 'Kaew', fullName: 'Kaewta Sukjai', gender: 'F', hook: 'Does the Warorot flower runs.', lean: { stamina: 5, charm: 5 }, zone: 'riverside' },
  { nickname: 'Jum', fullName: 'Sunee Chaiwong', gender: 'F', hook: 'Speaks fluent Kham Mueang.', lean: { charm: 5, english: -10 } },
  { nickname: 'Pim', fullName: 'Pimchanok Saengsri', gender: 'F', hook: 'A CMU graduate.', lean: { english: 20, driving: -10 }, zone: 'cmu' },
  { nickname: 'Joy', fullName: 'Achara Panyasri', gender: 'F', hook: 'Used to drive for tour groups.', lean: { english: 15, charm: 10 } },
  { nickname: 'Status', fullName: 'Nuttida Kaewsai', gender: 'F', hook: 'Posts every ride online.', lean: { charm: 10, honesty: -5 } },
  { nickname: 'Pu', fullName: 'Pranee Thongdee', gender: 'F', hook: 'Grandmotherly; feeds her passengers.', lean: { charm: 20, stamina: -10 } },
  { nickname: 'Jan', fullName: 'Chanthra Duangkham', gender: 'F', hook: '“Moon” — prefers the night shift.', lean: { stamina: 10 }, shift: 'night' },
  { nickname: 'Tui', fullName: 'Kulap Inthorn', gender: 'F', hook: 'From a Bo Sang umbrella family.', lean: { honesty: 10 } },
  { nickname: 'Aom', fullName: 'Wipa Khamkaew', gender: 'F', hook: 'A Nong Hoi local.', lean: { driving: 5 } },
];

/**
 * Parting words of a driver who quits. Phrases from culture.md §5 (bo pen yang,
 * pik ban, jai yen yen); the Grab line from economics.md §7 (app competition).
 */
export const QUIT_LINES = [
  'Bo pen yang, boss… pik ban. I’m going home.',
  'My cousin drives for Grab now. Better money.',
  'Jai yen yen only goes so far.',
  'I can’t feed my family on this. Khop khun, and goodbye.',
];
