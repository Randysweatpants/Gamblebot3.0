#!/usr/bin/env node
/**
 * Direct test of the player matching logic against balldontlie API
 * This tests the getBdlPlayerId function without needing Odds API credits
 */

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
const BALLDONTLIE_BASE = "https://api.balldontlie.io/v1";
const TIMEOUT_MS = 8000;

if (!BALLDONTLIE_API_KEY) {
  console.error("ERROR: BALLDONTLIE_API_KEY environment variable not set");
  process.exit(1);
}

function normalizePlayerName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[.,\-']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function testPlayerMatching(playerName) {
  const normalizedOddsName = normalizePlayerName(playerName);
  console.log(`\nTesting: "${playerName}"`);
  console.log(`Normalized: "${normalizedOddsName}"`);

  const nameParts = normalizedOddsName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 1) {
    console.log("❌ Could not parse name");
    return null;
  }

  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];

  console.log(`  First name: "${firstName}", Last name: "${lastName}"`);

  let players = [];

  // Strategy 1: Search by first name
  try {
    const firstNameUrl = new URL(`${BALLDONTLIE_BASE}/players`);
    firstNameUrl.searchParams.set("search", firstName);
    firstNameUrl.searchParams.set("per_page", "20");

    console.log(`  Searching by first name: "${firstName}"...`);
    const resp = await fetchWithTimeout(firstNameUrl.toString(), {
      headers: { Authorization: BALLDONTLIE_API_KEY },
    });

    if (resp.ok) {
      const data = await resp.json();
      players = Array.isArray(data.data) ? data.data : [];
      console.log(`  Found ${players.length} results`);
    } else {
      console.log(`  First name search failed: ${resp.status}`);
    }
  } catch (err) {
    console.log(`  First name search error: ${err.message}`);
  }

  // Look for exact full-name match in first-name search results
  if (players.length > 0) {
    let matchedPlayer = players.find((p) => {
      const bdlFullName = normalizePlayerName(
        `${p.first_name} ${p.last_name}`
      );
      return bdlFullName === normalizedOddsName;
    });
    if (matchedPlayer && matchedPlayer.id) {
      console.log(
        `  ✅ MATCHED on first-name search: ${matchedPlayer.first_name} ${matchedPlayer.last_name} (ID: ${matchedPlayer.id})`
      );
      return matchedPlayer.id;
    } else {
      console.log(`  No exact match in first-name results`);
      console.log(
        `    Results: ${players.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}`
      );
    }
  }

  // Strategy 2: Search by last name if first name search didn't match
  try {
    const lastNameUrl = new URL(`${BALLDONTLIE_BASE}/players`);
    lastNameUrl.searchParams.set("search", lastName);
    lastNameUrl.searchParams.set("per_page", "20");

    console.log(`  Searching by last name: "${lastName}"...`);
    const resp = await fetchWithTimeout(lastNameUrl.toString(), {
      headers: { Authorization: BALLDONTLIE_API_KEY },
    });

    if (resp.ok) {
      const data = await resp.json();
      players = Array.isArray(data.data) ? data.data : [];
      console.log(`  Found ${players.length} results`);
    } else {
      console.log(`  Last name search failed: ${resp.status}`);
    }
  } catch (err) {
    console.log(`  Last name search error: ${err.message}`);
  }

  if (players.length === 0) {
    console.log("❌ NO MATCH: No results from last-name search");
    return null;
  }

  // Look for exact full-name match in last-name search results
  let matchedPlayer = players.find((p) => {
    const bdlFullName = normalizePlayerName(
      `${p.first_name} ${p.last_name}`
    );
    return bdlFullName === normalizedOddsName;
  });

  if (matchedPlayer && matchedPlayer.id) {
    console.log(
      `  ✅ MATCHED on last-name search: ${matchedPlayer.first_name} ${matchedPlayer.last_name} (ID: ${matchedPlayer.id})`
    );
    return matchedPlayer.id;
  } else {
    console.log(`❌ NO EXACT MATCH in last-name results`);
    console.log(
      `    Results: ${players.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}`
    );
    return null;
  }
}

// Test cases: Common NBA player names
const testPlayers = [
  "LeBron James",
  "Quentin Grimes",
  "Brook Lopez",
  "Stephen Curry",
  "Naji Marshall",
  "Anthony Davis",
  "Jayson Tatum",
  "Kevin Durant",
];

async function runTests() {
  console.log("=== Player Matching Test ===");
  console.log(`Using balldontlie API key: ${BALLDONTLIE_API_KEY.slice(0, 8)}...`);

  let successCount = 0;
  let failureCount = 0;

  for (const player of testPlayers) {
    const result = await testPlayerMatching(player);
    if (result) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`✅ Matched: ${successCount}/${testPlayers.length}`);
  console.log(`❌ Failed: ${failureCount}/${testPlayers.length}`);
  console.log(`Success rate: ${((successCount / testPlayers.length) * 100).toFixed(1)}%`);
}

runTests().catch(console.error);
