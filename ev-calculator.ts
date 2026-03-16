/**
 * EV Calculator - sport-agnostic expected value calculation
 */

/**
 * Convert American odds to implied probability
 */
export function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Remove the vig from implied probabilities
 * Returns devigged probabilities that sum to 1.0
 */
export function devig(impliedOver: number, impliedUnder: number): { over: number; under: number } {
  const total = impliedOver + impliedUnder;
  return {
    over: impliedOver / total,
    under: impliedUnder / total,
  };
}

/**
 * Calculate expected value for a bet
 * @param fairProb - fair probability of winning (0-1)
 * @param odds - American odds on the bet
 * @returns EV as a decimal (e.g. 0.07 = 7% EV)
 */
export function calculateEV(fairProb: number, odds: number): number {
  let profit: number;
  let loss: number;

  if (odds > 0) {
    profit = odds / 100;
    loss = 1;
  } else {
    profit = 100 / Math.abs(odds);
    loss = 1;
  }

  return fairProb * profit - (1 - fairProb) * loss;
}

/**
 * Convert a projected stat to fair probabilities using a normal distribution approximation
 * @param projection - projected stat value
 * @param line - the prop line
 * @param stddev - estimated standard deviation (defaults to ~30% of projection)
 */
export function projectionToFairProbs(
  projection: number,
  line: number,
  stddev?: number
): { fairOver: number; fairUnder: number } {
  const sigma = stddev ?? Math.max(projection * 0.35, 0.3);
  // Use the logistic function as a normal CDF approximation
  const z = (line + 0.5 - projection) / sigma; // +0.5 continuity correction for discrete stats
  const fairUnder = 1 / (1 + Math.exp(-1.7 * z));
  const fairOver = 1 - fairUnder;
  return { fairOver, fairUnder };
}

/**
 * Calculate a confidence score (0-100) based on:
 * - Data availability (how many games of history)
 * - Projection edge (how far projection is from line)
 * - EV magnitude
 */
export function calculateConfidence(params: {
  gamesPlayed: number;
  projection: number;
  line: number;
  bestEV: number;
  opponentAdjAvailable: boolean;
}): number {
  const { gamesPlayed, projection, line, bestEV, opponentAdjAvailable } = params;

  let score = 0;

  // Data quality: up to 35 points
  if (gamesPlayed >= 10) score += 35;
  else if (gamesPlayed >= 5) score += 25;
  else if (gamesPlayed >= 3) score += 15;
  else score += 5;

  // Edge size (projection vs line): up to 30 points
  const edgePct = Math.abs(projection - line) / (line || 1);
  if (edgePct >= 0.25) score += 30;
  else if (edgePct >= 0.15) score += 22;
  else if (edgePct >= 0.08) score += 14;
  else score += 5;

  // EV magnitude: up to 25 points
  const evAbs = Math.abs(bestEV);
  if (evAbs >= 0.08) score += 25;
  else if (evAbs >= 0.05) score += 18;
  else if (evAbs >= 0.02) score += 10;
  else score += 3;

  // Opponent context: up to 10 points
  if (opponentAdjAvailable) score += 10;

  return Math.min(100, Math.max(0, Math.round(score)));
}
