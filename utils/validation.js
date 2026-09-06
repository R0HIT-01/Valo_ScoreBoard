/**
 * Data validation utilities for Canonical Match Data
 * Used by both frontend and backend
 */

export const CONFIG = {
  TEAMS: [
    "TEAM PTSD",
    "TEAM UltraViolence",
    "TEAM We Mind Esp",
    "TEAM Redline",
    "TEAM Hexa",
    "TEAM JBGD",
    "TEAM Plastic Gng",
  ],
  EXPECTED_PLAYERS_PER_TEAM: 5,
  EXPECTED_TOTAL_PLAYERS: 10,
};

export const PLAYER_FIELDS = [
  { key: "name", label: "Player", type: "string", required: true },
  { key: "agent", label: "Agent", type: "string", required: true },
  { key: "acs", label: "ACS", type: "number", required: true },
  { key: "kda", label: "K/D/A", type: "string", required: true, format: "XX/XX/XX" },
  { key: "econ", label: "ECON", type: "number", required: true },
  { key: "firstBloods", label: "First Bloods", type: "number", required: true },
  { key: "plants", label: "Plants", type: "number", required: true },
  { key: "defuses", label: "Defuses", type: "number", required: true },
];

/**
 * Validate a single player object
 */
export function validatePlayer(player, teamLabel, playerIndex) {
  const errors = [];

  if (!player || typeof player !== "object") {
    return [`${teamLabel} Player ${playerIndex + 1}: Player data is invalid or missing`];
  }

  // Normalize aliases
  const normalized = {
    name: player.name || player.player,
    agent: player.agent,
    acs: player.acs,
    kda: player.kda,
    econ: player.econ,
    firstBloods: player.firstBloods !== undefined ? player.firstBloods : player.fb,
    plants: player.plants,
    defuses: player.defuses,
  };

  PLAYER_FIELDS.forEach(field => {
    const value = normalized[field.key];

    // Check if required / missing
    if (field.required && (value === null || value === undefined || String(value).trim() === "")) {
      errors.push(`${teamLabel} Player ${playerIndex + 1}: ${field.label} is required`);
      return;
    }

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      if (field.type === "number") {
        const num = Number(value);
        if (isNaN(num)) {
          errors.push(`${teamLabel} Player ${playerIndex + 1}: ${field.label} must be a valid number`);
        }
      }

      if (field.format === "XX/XX/XX") {
        if (!/^\d+\/\d+\/\d+$/.test(String(value).trim())) {
          errors.push(`${teamLabel} Player ${playerIndex + 1}: ${field.label} must be in format XX/XX/XX (e.g., 24/12/5)`);
        }
      }
    }
  });

  return errors;
}

/**
 * Validate a team object (canonical structure: { name, detectedColor, players })
 */
export function validateTeam(team, teamLabel) {
  const errors = [];

  if (!team || typeof team !== "object") {
    return [`${teamLabel} data is missing`];
  }

  const teamName = team.name || team.teamName;

  if (!teamName || String(teamName).trim() === "") {
    errors.push(`${teamLabel} name is required`);
  } else if (!CONFIG.TEAMS.includes(String(teamName).trim())) {
    errors.push(`${teamLabel} name "${teamName}" is not in the list of valid teams`);
  }

  if (!team.players || !Array.isArray(team.players)) {
    errors.push(`${teamLabel} players must be an array`);
    return errors;
  }

  if (team.players.length !== CONFIG.EXPECTED_PLAYERS_PER_TEAM) {
    errors.push(`${teamLabel} must have exactly ${CONFIG.EXPECTED_PLAYERS_PER_TEAM} players, got ${team.players.length}`);
  }

  team.players.forEach((player, idx) => {
    errors.push(...validatePlayer(player, teamLabel, idx));
  });

  return errors;
}

/**
 * Validate complete canonical match data object
 */
export function validateMatchData(matchData) {
  const errors = [];

  if (!matchData || typeof matchData !== "object") {
    return { valid: false, errors: ["Match data object is required"] };
  }

  const matchDate = matchData.matchDate || matchData.date;
  const { teamA, teamB, matchId } = matchData;

  // Validate Match ID
  if (matchId === undefined || matchId === null || String(matchId).trim() === "") {
    errors.push("Match ID is required");
  } else if (typeof matchId !== "string" || !/^M\d+$/.test(String(matchId).trim())) {
    errors.push("Match ID must be in format M + digits (e.g. M001, M025)");
  }

  // Validate date
  if (!matchDate) {
    errors.push("Match date is required");
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(matchDate).trim())) {
    errors.push("Match date must be in YYYY-MM-DD format");
  }

  // Validate teams
  errors.push(...validateTeam(teamA, "Team A"));
  errors.push(...validateTeam(teamB, "Team B"));

  // Validate distinct teams
  const nameA = teamA?.name || teamA?.teamName;
  const nameB = teamB?.name || teamB?.teamName;
  if (nameA && nameB && nameA === nameB) {
    errors.push("Team A and Team B must be different teams");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize player data into canonical player object
 */
export function sanitizePlayer(player) {
  return {
    name: String(player.name || player.player || "").trim(),
    agent: String(player.agent || "").trim(),
    acs: Number(player.acs || 0),
    kda: String(player.kda || "").trim(),
    econ: Number(player.econ || 0),
    firstBloods: Number(player.firstBloods !== undefined ? player.firstBloods : (player.fb !== undefined ? player.fb : 0)),
    plants: Number(player.plants || 0),
    defuses: Number(player.defuses || 0),
  };
}

/**
 * Sanitize team data into canonical team object
 */
export function sanitizeTeam(team) {
  return {
    name: String(team.name || team.teamName || "").trim(),
    detectedColor: String(team.detectedColor || team.color || "unknown").trim(),
    players: (team.players || []).map(sanitizePlayer),
  };
}

/**
 * Sanitize match data into canonical match object
 */
export function sanitizeMatchData(matchData) {
  return {
    matchId: String(matchData.matchId || "").trim(),
    matchDate: String(matchData.matchDate || matchData.date || "").trim(),
    teamA: sanitizeTeam(matchData.teamA || {}),
    teamB: sanitizeTeam(matchData.teamB || {}),
  };
}


/**
 * Format date for display
 */
export function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString + "T00:00:00Z");
  return date.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

