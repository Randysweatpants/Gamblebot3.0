import { Router, type IRouter } from "express";
import { db, playersTable, playerGameLogsTable, propsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/player/:playerSlug", async (req, res) => {
  try {
    const { playerSlug } = req.params;
    const sport = (req.query.sport as string) || "NHL";

    const [player] = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.player_slug, playerSlug), eq(playersTable.sport, sport)));

    if (!player) {
      res.status(404).json({ error: "Player not found", detail: `No player with slug '${playerSlug}' found for sport '${sport}'` });
      return;
    }

    const gameLogs = await db
      .select()
      .from(playerGameLogsTable)
      .where(
        and(
          eq(playerGameLogsTable.player_slug, playerSlug),
          eq(playerGameLogsTable.sport, sport)
        )
      )
      .orderBy(sql`${playerGameLogsTable.game_date} DESC`)
      .limit(15);

    // Compute season stats from logs
    const totalGames = gameLogs.length;
    const totals = gameLogs.reduce(
      (acc, g) => ({
        goals: acc.goals + (g.goals ?? 0),
        assists: acc.assists + (g.assists ?? 0),
        points: acc.points + (g.points ?? 0),
        shots: acc.shots + (g.shots_on_goal ?? 0),
        plusMinus: acc.plusMinus + (g.plus_minus ?? 0),
      }),
      { goals: 0, assists: 0, points: 0, shots: 0, plusMinus: 0 }
    );

    const seasonStats =
      totalGames > 0
        ? {
            games_played: totalGames,
            goals_per_game: Math.round((totals.goals / totalGames) * 100) / 100,
            assists_per_game: Math.round((totals.assists / totalGames) * 100) / 100,
            points_per_game: Math.round((totals.points / totalGames) * 100) / 100,
            shots_per_game: Math.round((totals.shots / totalGames) * 100) / 100,
            plus_minus: totals.plusMinus,
            line_assignment: player.line_assignment,
            pp_line: player.pp_line,
          }
        : {};

    // Today's props for this player
    const today = new Date().toISOString().split("T")[0];
    const todayProps = await db
      .select()
      .from(propsTable)
      .where(
        and(
          eq(propsTable.player_slug, playerSlug),
          eq(propsTable.sport, sport),
          eq(propsTable.game_date, today)
        )
      );

    const formattedGameLog = gameLogs.map((g) => ({
      date: g.game_date,
      opponent: g.opponent_abbr || g.opponent,
      result: g.result,
      goals: g.goals ?? null,
      assists: g.assists ?? null,
      points: g.points ?? null,
      shots_on_goal: g.shots_on_goal ?? null,
      toi: g.toi ?? null,
      pp_toi: g.pp_toi ?? null,
      plus_minus: g.plus_minus ?? null,
      home_away: g.home_away,
    }));

    const matchupNotes = player.line_assignment
      ? `${player.player_name} plays on ${player.line_assignment} and ${player.pp_line ? `${player.pp_line} power play` : "no tracked PP unit"}.`
      : null;

    const roleNotes =
      totalGames > 0
        ? `Averaging ${(totals.shots / totalGames).toFixed(1)} shots, ${(totals.points / totalGames).toFixed(2)} points, and ${(totals.assists / totalGames).toFixed(2)} assists per game over last ${totalGames} games.`
        : null;

    res.json({
      player_name: player.player_name,
      player_slug: player.player_slug,
      team: player.team,
      position: player.position,
      sport: player.sport,
      game_log: formattedGameLog,
      season_stats: seasonStats,
      today_props: todayProps.map((p) => ({
        id: p.id,
        sport: p.sport,
        event_id: p.event_id,
        game: `${p.team_abbr} vs ${p.opponent_abbr}`,
        game_time: "",
        player_name: p.player_name,
        player_slug: p.player_slug,
        team: p.team,
        team_abbr: p.team_abbr,
        opponent: p.opponent,
        opponent_abbr: p.opponent_abbr,
        market: p.market,
        line: p.line,
        sportsbook: p.sportsbook,
        over_odds: p.over_odds ?? null,
        under_odds: p.under_odds ?? null,
        projection: null,
        implied_over_probability: null,
        implied_under_probability: null,
        fair_over_probability: null,
        fair_under_probability: null,
        ev_over: null,
        ev_under: null,
        best_side: null,
        best_ev: null,
        confidence: null,
        matchup_notes: null,
        last_5_avg: null,
        last_10_avg: null,
        season_avg: null,
        home_away: p.home_away ?? null,
        is_back_to_back: p.is_back_to_back ?? null,
      })),
      matchup_notes: matchupNotes,
      role_notes: roleNotes,
    });
  } catch (err) {
    console.error("GET /player/:playerSlug error:", err);
    res.status(500).json({ error: "Failed to fetch player detail", detail: String(err) });
  }
});

export default router;
