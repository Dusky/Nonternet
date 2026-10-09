// MUD characters as the rest of the site sees them (docs/09): a person's characters on their profile,
// and the one they feature next to their name on board posts. The MUD is the source of truth; core keeps
// a copy so any part of the site can use these.
export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type Ability = (typeof ABILITIES)[number];

export interface CharacterView {
  id: string;           // c_…, stable for the character's life
  name: string;
  level: number;
  xp: number;
  hp: number;
  hp_max: number;
  coins: number;
  abilities: Record<Ability, number>;
  created_at: string;
  tower: { season: number; best: number; checkpoint: number } | null; // this season's climb (docs/18)
}

// The tower's leaderboard (docs/18).
export interface TowerLeaderboard { season: number | null; leaders: { name: string; level: number; best: number; handle: string }[] }

// The short form shown beside a name, e.g. on a board post.
export interface CharacterBadge { id: string; name: string; level: number }

export interface PublicProfile {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  role: 'user' | 'trusted' | 'admin';
  joined_at: string;
  homepage_url: string | null;
  rings: { slug: string; name: string }[];
  characters: CharacterView[];
  featured_character_id: string | null;
  status_line: string | null; away: boolean;
  plan: string;
  pronouns: string | null; location: string | null; links: { label: string; url: string }[];
  // Coarse, and absent when the person has turned it off.
  last_seen: 'today' | 'this_week' | 'a_while' | null;
  homepage: { title: string; updated_at: string | null } | null;
  // Recent public activity: posts on public boards, site-wiki pages they edited, and their homepage being updated.
  activity: { kind: 'post' | 'wiki' | 'homepage'; at: string; title: string; link: { app: 'boards' | 'wiki' | 'homepages'; to: string }; place: string | null }[];
  // Recent threads and replies on public boards only.
  recent_posts: { id: string; thread_id: string; subject: string; posted_at: string; board: { slug: string; name: string } }[];
}
