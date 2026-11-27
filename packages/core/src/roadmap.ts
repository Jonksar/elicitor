import { ElicitorError } from "./errors.ts";
import type { RoadmapItem } from "./types.ts";

export interface MemoryRoadmapOptions {
  /** Associates initial viewerVoted flags with this user, already included in the seed counts. */
  readonly userId?: string;
}

export interface MemoryRoadmap {
  list(userId: string): ReadonlyArray<RoadmapItem>;
  vote(userId: string, id: string, voted: boolean): Promise<RoadmapItem>;
}

interface Row {
  readonly item: RoadmapItem;
  readonly voters: Set<string>;
}

/** In-memory roadmap for tests and demos. Reads return copies and votes change synchronously. */
export const createMemoryRoadmap = (
  items: ReadonlyArray<RoadmapItem>,
  options: MemoryRoadmapOptions = {},
): MemoryRoadmap => {
  const rows = new Map<string, Row>(
    items.map((item) => {
      const seeded = options.userId !== undefined && item.viewerVoted;
      return [
        item.id,
        {
          item: { ...item, votes: seeded ? Math.max(0, item.votes - 1) : item.votes },
          voters: new Set(seeded ? [options.userId!] : []),
        },
      ];
    }),
  );
  const snapshot = (row: Row, userId: string): RoadmapItem => ({
    ...row.item,
    votes: row.item.votes + row.voters.size,
    viewerVoted: row.voters.has(userId),
  });

  return {
    list(userId) {
      return [...rows.values()].map((row) => snapshot(row, userId));
    },
    async vote(userId, id, voted) {
      const row = rows.get(id);
      if (!row) throw new ElicitorError("not_found", "Roadmap item not found");
      if (row.item.stage === "shipped") {
        throw new ElicitorError("invalid", "Votes on shipped roadmap items cannot be changed");
      }
      if (voted) row.voters.add(userId);
      else row.voters.delete(userId);
      return snapshot(row, userId);
    },
  };
};
