// /api/stats.js — Vercel serverless function
// Usage:
//   /api/stats?type=group&groupId=936632772          → group info
//   /api/stats?type=groupGames&groupId=936632772      → group info + all public games' stats
//   /api/stats?type=game&placeId=920587237             → single game stats

export default async function handler(req, res) {
  const { type, placeId, universeId, groupId: groupIdParam } = req.query;
  const groupId = groupIdParam || "936632772"; // defaults to your group

  try {
    if (type === "game") {
      return res.status(200).json(await getGameStats({ placeId, universeId }));
    }

    if (type === "group") {
      return res.status(200).json(await getGroupInfo(groupId));
    }

    if (type === "groupGames") {
      const group = await getGroupInfo(groupId);
      const universeIds = await getAllPublicGameIds(groupId);

      if (universeIds.length === 0) {
        return res.status(200).json({ group, games: [] });
      }

      const games = await getStatsForUniverseIds(universeIds);
      return res.status(200).json({ group, gameCount: games.length, games });
    }

    return res.status(400).json({ error: "Set type=game, type=group, or type=groupGames." });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch data.", detail: err.message });
  }
}

// ---------- helpers ----------

async function getGroupInfo(groupId) {
  const r = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
  if (!r.ok) throw new Error("Group not found.");
  const g = await r.json();
  return {
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
    owner: g.owner?.username,
  };
}

// Paginates through every public game owned by the group, collecting universe IDs.
async function getAllPublicGameIds(groupId) {
  let ids = [];
  let cursor = "";

  do {
    const url = `https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=Public&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Could not fetch group's games.");
    const data = await r.json();

    ids = ids.concat((data.data || []).map((g) => g.id)); // g.id is the universeId
    cursor = data.nextPageCursor || "";
  } while (cursor);

  return ids;
}

// Fetches core stats + votes for a batch of universeIds (comma-separated, up to ~100 at a time).
async function getStatsForUniverseIds(universeIds) {
  const chunks = chunkArray(universeIds, 100);
  let results = [];

  for (const chunk of chunks) {
    const idsParam = chunk.join(",");

    const [gamesRes, votesRes] = await Promise.all([
      fetch(`https://games.roblox.com/v1/games?universeIds=${idsParam}`),
      fetch(`https://games.roblox.com/v1/games/votes?universeIds=${idsParam}`),
    ]);

    const gamesData = (await gamesRes.json()).data || [];
    const votesData = (await votesRes.json()).data || [];
    const votesById = Object.fromEntries(votesData.map((v) => [v.id, v]));

    for (const game of gamesData) {
      const votes = votesById[game.id] || { upVotes: 0, downVotes: 0 };
      const totalVotes = votes.upVotes + votes.downVotes;
      const likeRatio = totalVotes > 0 ? votes.upVotes / totalVotes : null;
      const ccuVisitRatio = game.visits > 0 ? game.playing / game.visits : null;

      results.push({
        universeId: game.id,
        name: game.name,
        playing: game.playing,
        visits: game.visits,
        favoritedCount: game.favoritedCount,
        upVotes: votes.upVotes,
        downVotes: votes.downVotes,
        likeRatio,
        ccuVisitRatio,
      });
    }
  }

  return results;
}

async function getGameStats({ placeId, universeId }) {
  if (!placeId && !universeId) throw new Error("Provide a placeId or universeId.");

  let uid = universeId;
  if (!uid) {
    const uRes = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!uRes.ok) throw new Error("Could not resolve placeId.");
    uid = (await uRes.json()).universeId;
  }

  const [gamesRes, votesRes] = await getStatsForUniverseIds([uid]);
  return gamesRes; // single object since getStatsForUniverseIds returns an array — see note below
}