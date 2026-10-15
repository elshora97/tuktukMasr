/** Shared between the race server's /leaderboard endpoint and the game. */
export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  /** Meters driven. */
  distance: number;
  overtakes: number;
  /** Epoch ms. */
  at: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  /** For a submission: the new entry's id and its rank (1 = first). */
  id?: string;
  rank?: number;
}
