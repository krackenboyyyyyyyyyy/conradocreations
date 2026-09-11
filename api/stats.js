// /api/stats.js — Vercel serverless function
// Usage:
//   /api/stats?type=group&groupId=936632772
//   /api/stats?type=groupGames&groupId=936632772
//   /api/stats?type=game&placeId=920587237

export default async function handler(req, res) {
  const { type, placeId, universeId, groupId: groupIdParam } = req.query;
  const groupId = groupIdParam || "936632772";

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
    name: g.name,
    memberCount: g.memberCount,
  };
}

async function getAllPublicGameIds(groupId) {
  let ids = [];
  let cursor = "";

  do {
    const url = `https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=Public&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Could not fetch group's games.");
    const data = await r.json();

    ids = ids.concat((data.data || []).map((g) => g.id));
    cursor = data.nextPageCursor || "";
  } while (cursor);

  return ids;
}

async function getIconsForUniverseIds(universeIds) {
  const chunks = chunkArray(universeIds, 100);
  let iconsById = {};

  for (const chunk of chunks) {
    const idsParam = chunk.join(",");
    const r = await fetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idsParam}&size=512x512&format=Png&isCircular=false`
    );
    if (!r.ok) continue;
    const data = (await r.json()).data || [];
    data.forEach((item) => {
      iconsById[item.targetId] = item.imageUrl;
    });
  }

  return iconsById;
}

async function getStatsForUniverseIds(universeIds) {
  const chunks = chunkArray(universeIds, 100);
  let results = [];
  const iconsById = await getIconsForUniverseIds(universeIds);

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
      const likeRatio = totalVotes > 0 ? Math.round((votes.upVotes / totalVotes) * 100) + "%" : "—";

      results.push({
        name: game.name,
        icon: iconsById[game.id] || null,
        visits: game.visits,
        playing: game.playing,
        likeRatio,
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

  const results = await getStatsForUniverseIds([uid]);
  return results[0];
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}