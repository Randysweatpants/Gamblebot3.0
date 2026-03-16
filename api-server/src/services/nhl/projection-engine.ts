/**
 * NHL Projection Engine
 * Weighted model:
 *   35% last 10 average
 *   25% last 5 average
 *   20% season average
 *   10% opponent matchup adjustment
 *   10% usage/ice time/power play/role adjustment
 */

import type { PlayerGameLog } from "@workspace/db";

export type Market = "points" | "assists" | "shots_on_goal" | "goals";

/**
 * Extract stat value from game log for a given market
 */
function getStat(log: PlayerGameLog, market: Market): number {
  switch (market) {
    case "points":
      return (log.points ?? 0);
    case "assists":
      return (log.assists ?? 0);
    case "shots_on_goal":
      return (log.shots_on_goal ?? 0);
    case "goals":
      return (log.goals ?? 0);
    default:
      return 0;
  }
}

/**
 * Compute weighted average from game logs
 */
export function computeProjection(params: {
  gameLogs: PlayerGameLog[];
  market: Market;
  opponentAdj?: number; // +/- adjustment (e.g. 0.1 = 10% bump, -0.05 = 5% reduction)
  usageAdj?: number;    // +/- adjustment for ice time / power play role
  isBackToBack?: boolean;
  homeAway?: "home" | "away";
}): {
  projection: number;
  last5Avg: number;
  last10Avg: number;
  seasonAvg: number;
  opponentAdj: number;
  usageAdj: number;
} {
  const { gameLogs, market, opponentAdj = 0, usageAdj = 0, isBackToBack = false, homeAway } = params;

  if (gameLogs.length === 0) {
    return {
      projection: 0,
      last5Avg: 0,
      last10Avg: 0,
      seasonAvg: 0,
      opponentAdj: 0,
      usageAdj: 0,
    };
  }

  const stats = gameLogs.map((g) => getStat(g, market));
  const seasonAvg = stats.reduce((a, b) => a + b, 0) / stats.length;

  const last10 = stats.slice(0, 10);
  const last10Avg = last10.reduce((a, b) => a + b, 0) / last10.length;

  const last5 = stats.slice(0, 5);
  const last5Avg = last5.reduce((a, b) => a + b, 0) / last5.length;

  // Weighted base projection
  let projection = last10Avg * 0.35 + last5Avg * 0.25 + seasonAvg * 0.20;

  // Opponent adjustment (10% weight)
  const opponentComponent = projection * (1 + opponentAdj) * 0.10;
  projection = projection * 0.90 + opponentComponent;

  // Usage/role adjustment (10% weight)
  const usageComponent = projection * (1 + usageAdj) * 0.10;
  projection = projection * 0.90 + usageComponent;

  // Back-to-back penalty (reduce by 8%)
  if (isBackToBack) {
    projection *= 0.92;
  }

  // Home/away split adjustment (+3% home, -3% away for NHL)
  if (homeAway === "home") projection *= 1.03;
  if (homeAway === "away") projection *= 0.97;

  return {
    projection: Math.max(0, Math.round(projection * 100) / 100),
    last5Avg: Math.round(last5Avg * 100) / 100,
    last10Avg: Math.round(last10Avg * 100) / 100,
    seasonAvg: Math.round(seasonAvg * 100) / 100,
    opponentAdj,
    usageAdj,
  };
}

/**
 * Generate matchup notes string for a prop
 */
export function generateMatchupNotes(params: {
  playerName: string;
  team: string;
  opponent: string;
  market: Market;
  projection: number;
  line: number;
  last5Avg: number;
  last10Avg: number;
  seasonAvg: number;
  opponentAdj: number;
  homeAway?: string;
  isBackToBack?: boolean;
  evOver: number;
  evUnder: number;
}): string {
  const {
    playerName, market, projection, line, last5Avg, last10Avg, opponentAdj,
    homeAway, isBackToBack, evOver, evUnder,
  } = params;

  const notes: string[] = [];
  const marketLabel = market === "shots_on_goal" ? "shots" : market;
  const bestSide = evOver >= evUnder ? "over" : "under";
  const edge = projection - line;

  if (Math.abs(edge) >= 0.15) {
    notes.push(
      `Model projects ${projection.toFixed(2)} ${marketLabel} vs. line of ${line} — ${edge > 0 ? "edge on over" : "edge on under"}.`
    );
  }

  if (last5Avg > last10Avg * 1.15) {
    notes.push(`Hot streak: averaging ${last5Avg.toFixed(2)} ${marketLabel} over last 5 (L10: ${last10Avg.toFixed(2)}).`);
  } else if (last5Avg < last10Avg * 0.85) {
    notes.push(`Cooling off: averaging ${last5Avg.toFixed(2)} ${marketLabel} over last 5 (L10: ${last10Avg.toFixed(2)}).`);
  }

  if (opponentAdj > 0.05) {
    notes.push(`Favorable matchup — opponent allows above-average ${marketLabel}.`);
  } else if (opponentAdj < -0.05) {
    notes.push(`Tough matchup — opponent suppresses ${marketLabel} at above-average rate.`);
  }

  if (isBackToBack) {
    notes.push("Back-to-back game — slight usage reduction factored in.");
  }

  if (homeAway === "home") {
    notes.push("Home advantage applied (+3%).");
  }

  if (notes.length === 0) {
    notes.push(`Projection of ${projection.toFixed(2)} ${marketLabel} is ${Math.abs(edge) < 0.1 ? "near" : edge > 0 ? "above" : "below"} the line of ${line}.`);
  }

  return notes.join(" ");
}
