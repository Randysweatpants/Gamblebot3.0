/**
 * NHL Seed Data
 * Real-looking NHL player, game, and odds data for today's slate.
 * This represents real-world data that would come from official NHL APIs and sportsbooks.
 * Structure is designed to be replaced with live API calls.
 */

import { db, gamesTable, playersTable, playerGameLogsTable, propsTable, sportsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const TODAY = new Date().toISOString().split("T")[0];

const NHL_SPORTS = {
  id: "NHL",
  name: "National Hockey League",
  league: "NHL",
  active: true,
  markets: ["points", "assists", "shots_on_goal", "goals"],
};

const GAMES = [
  {
    event_id: `NHL_${TODAY}_BOS_TOR`,
    sport: "NHL",
    home_team: "Toronto Maple Leafs",
    away_team: "Boston Bruins",
    home_team_abbr: "TOR",
    away_team_abbr: "BOS",
    game_date: TODAY,
    game_time: "7:00 PM ET",
    venue: "Scotiabank Arena",
    status: "scheduled",
    home_goalie: "Joseph Woll",
    away_goalie: "Jeremy Swayman",
  },
  {
    event_id: `NHL_${TODAY}_NYR_PHI`,
    sport: "NHL",
    home_team: "Philadelphia Flyers",
    away_team: "New York Rangers",
    home_team_abbr: "PHI",
    away_team_abbr: "NYR",
    game_date: TODAY,
    game_time: "7:30 PM ET",
    venue: "Wells Fargo Center",
    status: "scheduled",
    home_goalie: "Samuel Ersson",
    away_goalie: "Igor Shesterkin",
  },
  {
    event_id: `NHL_${TODAY}_COL_VGK`,
    sport: "NHL",
    home_team: "Vegas Golden Knights",
    away_team: "Colorado Avalanche",
    home_team_abbr: "VGK",
    away_team_abbr: "COL",
    game_date: TODAY,
    game_time: "10:00 PM ET",
    venue: "T-Mobile Arena",
    status: "scheduled",
    home_goalie: "Adin Hill",
    away_goalie: "Alexandar Georgiev",
  },
  {
    event_id: `NHL_${TODAY}_EDM_CGY`,
    sport: "NHL",
    home_team: "Calgary Flames",
    away_team: "Edmonton Oilers",
    home_team_abbr: "CGY",
    away_team_abbr: "EDM",
    game_date: TODAY,
    game_time: "9:00 PM ET",
    venue: "Scotiabank Saddledome",
    status: "scheduled",
    home_goalie: "Dustin Wolf",
    away_goalie: "Stuart Skinner",
  },
];

const PLAYERS = [
  // BOS
  { player_slug: "david-pastrnak", player_name: "David Pastrnak", team: "Boston Bruins", team_abbr: "BOS", position: "RW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "brad-marchand", player_name: "Brad Marchand", team: "Boston Bruins", team_abbr: "BOS", position: "LW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "charlie-coyle", player_name: "Charlie Coyle", team: "Boston Bruins", team_abbr: "BOS", position: "C", line_assignment: "Line 2", pp_line: "PP2", sport: "NHL" },
  // TOR
  { player_slug: "auston-matthews", player_name: "Auston Matthews", team: "Toronto Maple Leafs", team_abbr: "TOR", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "william-nylander", player_name: "William Nylander", team: "Toronto Maple Leafs", team_abbr: "TOR", position: "RW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "mitch-marner", player_name: "Mitch Marner", team: "Toronto Maple Leafs", team_abbr: "TOR", position: "RW", line_assignment: "Line 2", pp_line: "PP1", sport: "NHL" },
  // NYR
  { player_slug: "artemi-panarin", player_name: "Artemi Panarin", team: "New York Rangers", team_abbr: "NYR", position: "LW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "mika-zibanejad", player_name: "Mika Zibanejad", team: "New York Rangers", team_abbr: "NYR", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "chris-kreider", player_name: "Chris Kreider", team: "New York Rangers", team_abbr: "NYR", position: "LW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  // PHI
  { player_slug: "travis-konecny", player_name: "Travis Konecny", team: "Philadelphia Flyers", team_abbr: "PHI", position: "RW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "sean-couturier", player_name: "Sean Couturier", team: "Philadelphia Flyers", team_abbr: "PHI", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  // COL
  { player_slug: "nathan-mackinnon", player_name: "Nathan MacKinnon", team: "Colorado Avalanche", team_abbr: "COL", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "mikko-rantanen", player_name: "Mikko Rantanen", team: "Colorado Avalanche", team_abbr: "COL", position: "RW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "cale-makar", player_name: "Cale Makar", team: "Colorado Avalanche", team_abbr: "COL", position: "D", line_assignment: "Pair 1", pp_line: "PP1", sport: "NHL" },
  // VGK
  { player_slug: "jack-eichel", player_name: "Jack Eichel", team: "Vegas Golden Knights", team_abbr: "VGK", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "mark-stone", player_name: "Mark Stone", team: "Vegas Golden Knights", team_abbr: "VGK", position: "RW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  // EDM
  { player_slug: "connor-mcdavid", player_name: "Connor McDavid", team: "Edmonton Oilers", team_abbr: "EDM", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "leon-draisaitl", player_name: "Leon Draisaitl", team: "Edmonton Oilers", team_abbr: "EDM", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "zach-hyman", player_name: "Zach Hyman", team: "Edmonton Oilers", team_abbr: "EDM", position: "LW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  // CGY
  { player_slug: "nazem-kadri", player_name: "Nazem Kadri", team: "Calgary Flames", team_abbr: "CGY", position: "C", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
  { player_slug: "jonathan-huberdeau", player_name: "Jonathan Huberdeau", team: "Calgary Flames", team_abbr: "CGY", position: "LW", line_assignment: "Line 1", pp_line: "PP1", sport: "NHL" },
];

// Game logs per player (last 15 games, most recent first)
// Format: [goals, assists, shots_on_goal, toi, pp_toi, plus_minus, date_offset_days_ago]
type RawLog = [number, number, number, string, string, number, number];

const PLAYER_GAME_LOG_DATA: Record<string, RawLog[]> = {
  "david-pastrnak": [
    [2,1,5,"19:22","3:45",2,1], [0,2,4,"18:55","3:12",1,3], [1,1,6,"20:01","4:02",0,5],
    [0,0,3,"17:44","2:30",-1,7], [1,2,7,"19:33","3:55",2,9], [0,1,4,"18:22","3:10",0,11],
    [2,0,5,"20:15","4:20",1,13], [1,1,4,"19:00","3:45",0,15], [0,2,3,"18:30","3:00",-1,17],
    [1,0,6,"19:45","4:10",2,19], [0,1,5,"18:55","3:30",0,21], [2,1,7,"20:22","4:45",3,23],
    [0,0,2,"17:30","2:00",-1,25], [1,2,5,"19:10","3:55",1,27], [0,1,4,"18:45","3:20",0,29],
  ],
  "brad-marchand": [
    [0,2,3,"17:55","2:50",1,1], [1,1,4,"18:10","2:35",0,3], [0,2,2,"16:30","1:55",-1,5],
    [1,0,3,"17:22","2:20",2,7], [0,1,4,"17:45","2:40",1,9], [1,1,3,"18:00","2:55",0,11],
    [0,0,2,"16:15","1:30",-2,13], [1,2,5,"18:30","3:10",2,15], [0,1,3,"17:40","2:45",1,17],
    [0,0,2,"16:55","2:00",-1,19], [1,1,4,"17:50","2:50",0,21], [0,2,3,"18:10","2:30",1,23],
    [1,0,4,"17:30","2:15",2,25], [0,1,2,"16:45","1:45",-1,27], [1,2,5,"18:25","3:00",3,29],
  ],
  "charlie-coyle": [
    [0,1,2,"16:30","1:20",0,1], [1,0,3,"17:00","1:30",1,3], [0,1,2,"16:15","0:55",-1,5],
    [0,0,2,"15:45","0:45",0,7], [1,1,3,"16:45","1:15",1,9], [0,0,1,"15:30","0:30",-1,11],
    [0,1,2,"16:20","1:00",0,13], [1,0,3,"16:55","1:20",2,15], [0,0,2,"15:40","0:40",-1,17],
    [0,1,1,"15:55","0:55",0,19], [1,0,3,"16:30","1:10",1,21], [0,1,2,"16:10","0:50",0,23],
    [0,0,1,"15:20","0:30",-1,25], [1,1,3,"16:45","1:25",1,27], [0,0,2,"16:00","0:45",0,29],
  ],
  "auston-matthews": [
    [1,1,5,"20:30","3:50",1,1], [2,0,7,"21:00","4:15",2,3], [0,2,4,"19:45","3:20",0,5],
    [1,1,6,"20:15","3:45",1,7], [0,0,3,"18:30","2:30",-1,9], [2,1,8,"21:10","4:30",2,11],
    [1,0,5,"20:00","3:55",1,13], [0,2,4,"19:30","3:10",0,15], [1,1,6,"20:20","3:40",1,17],
    [0,0,2,"18:10","2:15",-2,19], [1,2,7,"20:45","4:20",2,21], [2,1,5,"21:00","4:00",1,23],
    [0,1,4,"19:50","3:30",0,25], [1,0,6,"20:30","3:55",1,27], [0,2,3,"19:15","3:00",0,29],
  ],
  "william-nylander": [
    [1,1,4,"18:45","2:55",1,1], [0,2,3,"18:10","2:40",0,3], [1,0,5,"19:00","3:10",1,5],
    [0,1,3,"17:55","2:25",0,7], [1,2,4,"19:10","3:20",2,9], [0,0,2,"17:30","2:00",-1,11],
    [2,0,6,"19:20","3:30",1,13], [0,1,4,"18:00","2:45",0,15], [1,1,5,"18:50","3:05",1,17],
    [0,0,3,"17:40","2:10",-1,19], [1,2,4,"19:00","3:15",2,21], [0,1,3,"18:20","2:50",0,23],
    [1,0,5,"18:55","3:00",1,25], [0,2,4,"18:30","2:55",1,27], [1,1,3,"18:10","2:40",0,29],
  ],
  "mitch-marner": [
    [0,3,3,"19:30","3:30",2,1], [0,2,2,"18:55","3:10",1,3], [1,1,4,"19:10","3:20",0,5],
    [0,2,3,"18:45","2:55",-1,7], [0,3,2,"19:20","3:15",2,9], [1,0,4,"18:30","2:45",0,11],
    [0,2,3,"19:00","3:05",1,13], [0,1,2,"18:10","2:30",-1,15], [1,2,4,"19:25","3:25",1,17],
    [0,1,3,"18:40","2:50",0,19], [0,3,2,"19:10","3:10",2,21], [1,1,3,"18:55","3:00",0,23],
    [0,2,4,"19:30","3:20",1,25], [0,1,2,"18:20","2:40",-1,27], [1,2,3,"19:05","3:05",0,29],
  ],
  "artemi-panarin": [
    [0,2,4,"19:10","3:30",1,1], [1,1,3,"18:45","3:10",0,3], [0,3,2,"19:30","3:45",2,5],
    [1,0,4,"18:20","2:55",-1,7], [0,2,3,"19:00","3:20",1,9], [1,1,5,"19:20","3:35",0,11],
    [0,2,3,"18:40","3:00",2,13], [1,0,4,"18:55","3:15",1,15], [0,3,3,"19:25","3:40",0,17],
    [0,1,2,"18:10","2:45",-1,19], [1,2,4,"19:05","3:20",2,21], [0,2,3,"18:50","3:05",1,23],
    [1,0,5,"19:15","3:30",0,25], [0,1,3,"18:30","2:50",-1,27], [1,2,4,"19:00","3:15",1,29],
  ],
  "mika-zibanejad": [
    [1,1,4,"19:00","2:50",0,1], [0,1,3,"18:30","2:30",1,3], [1,0,5,"19:20","3:10",-1,5],
    [0,2,3,"18:45","2:45",0,7], [1,1,4,"19:10","3:00",1,9], [0,0,2,"17:55","2:15",-2,11],
    [1,2,5,"19:25","3:20",1,13], [0,1,3,"18:40","2:40",0,15], [1,0,4,"19:00","2:55",1,17],
    [0,1,3,"18:20","2:30",-1,19], [1,2,5,"19:15","3:10",2,21], [0,0,2,"17:45","2:00",-1,23],
    [1,1,4,"19:00","2:50",1,25], [0,2,3,"18:35","2:35",0,27], [1,0,5,"19:20","3:05",1,29],
  ],
  "chris-kreider": [
    [1,0,4,"16:45","2:00",0,1], [0,1,3,"16:20","1:45",1,3], [1,0,5,"17:00","2:15",-1,5],
    [0,1,3,"16:30","1:55",0,7], [2,0,4,"17:10","2:20",2,9], [0,0,2,"15:55","1:30",-1,11],
    [1,1,5,"16:55","2:10",1,13], [0,0,3,"16:15","1:40",-1,15], [1,0,4,"16:45","2:00",0,17],
    [0,1,3,"16:30","1:50",1,19], [1,0,5,"17:00","2:15",0,21], [0,0,2,"15:45","1:25",-2,23],
    [1,1,4,"16:50","2:05",1,25], [0,0,3,"16:20","1:35",-1,27], [1,0,5,"16:55","2:10",0,29],
  ],
  "travis-konecny": [
    [1,1,4,"18:30","2:40",0,1], [0,2,3,"17:55","2:20",1,3], [1,0,5,"18:45","2:55",-1,5],
    [0,1,3,"18:10","2:30",0,7], [1,2,5,"19:00","3:00",1,9], [0,0,2,"17:30","2:00",-1,11],
    [1,1,4,"18:20","2:35",2,13], [0,1,3,"17:50","2:15",0,15], [1,0,5,"18:40","2:50",1,17],
    [0,2,3,"18:05","2:25",-1,19], [1,1,4,"18:30","2:40",0,21], [0,0,2,"17:20","1:55",-2,23],
    [1,2,5,"18:45","3:00",1,25], [0,1,3,"18:00","2:20",0,27], [1,0,4,"18:25","2:35",1,29],
  ],
  "sean-couturier": [
    [0,1,2,"18:30","1:30",1,1], [1,0,3,"18:55","1:45",-1,3], [0,1,2,"18:15","1:20",0,5],
    [0,0,2,"17:55","1:00",-1,7], [1,1,3,"19:00","1:40",1,9], [0,1,2,"18:30","1:25",0,11],
    [0,0,1,"17:40","0:55",-1,13], [1,0,3,"19:05","1:50",1,15], [0,1,2,"18:20","1:30",0,17],
    [0,0,2,"17:50","1:10",-1,19], [1,1,4,"18:55","1:40",1,21], [0,0,2,"18:10","1:15",0,23],
    [0,1,3,"18:35","1:35",-1,25], [1,0,2,"19:00","1:45",1,27], [0,1,3,"18:25","1:30",0,29],
  ],
  "nathan-mackinnon": [
    [0,3,5,"21:30","4:45",2,1], [1,2,6,"22:00","5:00",1,3], [2,1,7,"21:45","4:30",3,5],
    [0,2,4,"20:55","4:10",1,7], [1,3,6,"21:30","4:50",2,9], [0,1,3,"20:15","3:45",0,11],
    [2,2,7,"22:10","5:15",3,13], [0,2,5,"21:00","4:20",1,15], [1,3,6,"21:35","4:55",2,17],
    [0,1,4,"20:30","4:00",0,19], [1,2,5,"21:20","4:30",1,21], [2,1,7,"22:00","5:10",2,23],
    [0,3,4,"21:10","4:40",1,25], [1,2,6,"21:45","4:55",3,27], [0,1,3,"20:20","3:50",0,29],
  ],
  "mikko-rantanen": [
    [1,2,5,"18:55","3:20",1,1], [0,1,4,"18:30","3:00",0,3], [2,1,6,"19:10","3:30",2,5],
    [0,2,3,"18:15","2:55",-1,7], [1,1,5,"18:50","3:15",1,9], [0,0,2,"17:40","2:30",-1,11],
    [1,2,5,"19:00","3:25",0,13], [0,1,4,"18:25","3:05",1,15], [2,0,6,"19:15","3:35",2,17],
    [0,2,3,"18:10","2:50",-1,19], [1,1,5,"18:55","3:20",1,21], [0,0,3,"17:45","2:35",-1,23],
    [2,2,6,"19:10","3:40",2,25], [0,1,4,"18:30","3:10",0,27], [1,1,5,"18:50","3:25",1,29],
  ],
  "cale-makar": [
    [0,2,4,"25:30","3:55",2,1], [1,1,3,"26:00","4:10",1,3], [0,3,5,"25:45","4:20",3,5],
    [0,1,2,"24:30","3:30",0,7], [1,2,4,"25:55","4:00",2,9], [0,1,3,"25:10","3:45",1,11],
    [0,2,4,"25:40","4:15",2,13], [1,0,3,"25:20","3:30",0,15], [0,3,5,"26:10","4:30",3,17],
    [0,1,2,"24:45","3:20",-1,19], [1,2,4,"25:50","4:05",2,21], [0,1,3,"25:15","3:50",1,23],
    [0,2,5,"25:30","4:00",2,25], [1,1,3,"25:45","3:40",1,27], [0,2,4,"26:00","4:20",3,29],
  ],
  "jack-eichel": [
    [1,1,5,"19:30","3:20",1,1], [0,2,4,"18:55","3:00",0,3], [1,1,6,"19:45","3:35",1,5],
    [0,0,3,"18:10","2:30",-1,7], [1,2,5,"19:20","3:15",2,9], [0,1,4,"18:40","2:55",0,11],
    [1,0,6,"19:50","3:40",1,13], [0,2,3,"18:30","2:45",1,15], [1,1,5,"19:25","3:20",0,17],
    [0,0,3,"18:05","2:20",-1,19], [1,2,6,"19:40","3:35",1,21], [0,1,4,"18:50","3:00",0,23],
    [1,0,5,"19:30","3:25",1,25], [0,2,4,"19:00","3:10",2,27], [1,1,6,"19:45","3:40",0,29],
  ],
  "mark-stone": [
    [0,2,3,"17:30","2:30",1,1], [1,1,4,"17:55","2:45",0,3], [0,2,2,"17:10","2:15",1,5],
    [1,0,4,"17:45","2:40",-1,7], [0,1,3,"17:20","2:25",0,9], [1,2,5,"18:00","3:00",2,11],
    [0,1,3,"17:35","2:35",1,13], [1,0,4,"17:50","2:45",0,15], [0,2,3,"17:25","2:30",-1,17],
    [1,1,4,"17:55","2:50",1,19], [0,0,2,"16:55","2:00",-2,21], [1,2,5,"18:10","3:05",1,23],
    [0,1,3,"17:30","2:35",0,25], [1,0,4,"17:50","2:45",1,27], [0,2,3,"17:20","2:25",0,29],
  ],
  "connor-mcdavid": [
    [0,3,5,"21:45","4:50",2,1], [1,2,6,"22:10","5:10",1,3], [2,2,7,"21:55","5:00",3,5],
    [0,3,4,"21:20","4:35",1,7], [1,3,6,"22:00","5:15",2,9], [0,2,3,"20:30","4:00",0,11],
    [2,3,7,"22:20","5:30",3,13], [0,2,5,"21:10","4:25",1,15], [1,3,6,"21:45","5:00",2,17],
    [0,1,4,"20:40","4:05",0,19], [1,2,5,"21:30","4:45",1,21], [2,2,7,"22:15","5:20",2,23],
    [0,3,4,"21:20","4:50",1,25], [1,3,6,"22:00","5:10",3,27], [0,1,3,"20:25","3:55",0,29],
  ],
  "leon-draisaitl": [
    [1,2,5,"20:30","4:30",1,1], [0,1,4,"19:55","4:10",0,3], [2,1,6,"20:45","4:45",2,5],
    [0,2,3,"19:20","3:55",-1,7], [1,2,5,"20:30","4:35",1,9], [0,0,2,"18:40","3:20",-1,11],
    [1,3,6,"20:50","4:50",2,13], [0,1,4,"19:30","4:00",0,15], [2,1,5,"20:35","4:30",1,17],
    [0,2,3,"19:10","3:45",-1,19], [1,1,6,"20:40","4:40",2,21], [0,0,3,"18:50","3:25",-1,23],
    [1,2,5,"20:30","4:35",1,25], [0,1,4,"19:45","4:15",0,27], [2,1,6,"20:50","4:50",2,29],
  ],
  "zach-hyman": [
    [1,0,4,"16:30","2:00",1,1], [0,1,3,"16:10","1:45",0,3], [1,0,5,"16:45","2:10",-1,5],
    [0,0,3,"15:55","1:30",-1,7], [1,1,4,"16:35","2:05",1,9], [0,0,2,"15:40","1:20",-1,11],
    [1,0,5,"16:50","2:15",0,13], [0,1,3,"16:15","1:40",1,15], [1,0,4,"16:40","2:00",0,17],
    [0,0,2,"15:45","1:25",-1,19], [1,1,5,"16:45","2:10",1,21], [0,0,3,"15:55","1:30",-1,23],
    [1,0,4,"16:30","2:00",0,25], [0,1,3,"16:10","1:45",1,27], [1,0,5,"16:50","2:15",0,29],
  ],
  "nazem-kadri": [
    [1,1,3,"18:20","2:30",1,1], [0,1,3,"17:55","2:15",0,3], [1,0,4,"18:35","2:40",-1,5],
    [0,2,2,"18:00","2:20",1,7], [1,1,4,"18:25","2:35",0,9], [0,0,2,"17:30","1:55",-1,11],
    [1,1,4,"18:30","2:40",1,13], [0,1,3,"17:50","2:10",0,15], [1,0,4,"18:20","2:30",-1,17],
    [0,2,3,"18:05","2:25",1,19], [1,1,4,"18:35","2:45",0,21], [0,0,2,"17:25","1:50",-1,23],
    [1,2,4,"18:30","2:40",1,25], [0,1,3,"17:55","2:15",0,27], [1,0,4,"18:20","2:30",-1,29],
  ],
  "jonathan-huberdeau": [
    [0,2,3,"18:10","2:40",1,1], [1,1,4,"18:35","2:55",0,3], [0,2,2,"17:55","2:25",1,5],
    [1,0,3,"18:20","2:45",-1,7], [0,1,4,"18:00","2:30",0,9], [1,2,5,"18:40","3:00",2,11],
    [0,1,3,"17:45","2:20",1,13], [1,0,4,"18:25","2:50",0,15], [0,2,3,"18:05","2:35",-1,17],
    [1,1,4,"18:30","2:55",1,19], [0,0,2,"17:20","2:00",-1,21], [1,2,5,"18:45","3:05",2,23],
    [0,1,3,"18:10","2:40",0,25], [1,0,4,"18:30","2:55",1,27], [0,2,3,"18:00","2:30",0,29],
  ],
};

// Opponent adjustments for markets by team abbr
// Positive = opponent allows more (favorable for over), negative = opponent suppresses
const OPPONENT_ADJUSTMENTS: Record<string, Record<string, number>> = {
  TOR: { points: 0.07, assists: 0.05, shots_on_goal: 0.09, goals: 0.05 },
  BOS: { points: -0.03, assists: -0.02, shots_on_goal: 0.04, goals: -0.04 },
  NYR: { points: 0.02, assists: 0.04, shots_on_goal: 0.06, goals: 0.01 },
  PHI: { points: 0.08, assists: 0.07, shots_on_goal: 0.11, goals: 0.09 },
  COL: { points: -0.05, assists: -0.03, shots_on_goal: -0.04, goals: -0.06 },
  VGK: { points: -0.02, assists: -0.01, shots_on_goal: 0.02, goals: -0.03 },
  EDM: { points: 0.04, assists: 0.03, shots_on_goal: 0.07, goals: 0.03 },
  CGY: { points: 0.01, assists: 0.02, shots_on_goal: 0.03, goals: 0.01 },
};

// Props data: [player_slug, event_id, market, line, sportsbook, over_odds, under_odds]
type PropData = [string, string, string, number, string, number, number];

const PROPS_DATA: PropData[] = [
  // BOS vs TOR
  ["david-pastrnak", `NHL_${TODAY}_BOS_TOR`, "points", 1.5, "DraftKings", -130, +108],
  ["david-pastrnak", `NHL_${TODAY}_BOS_TOR`, "shots_on_goal", 4.5, "FanDuel", -118, -104],
  ["david-pastrnak", `NHL_${TODAY}_BOS_TOR`, "assists", 0.5, "BetMGM", -175, +142],
  ["brad-marchand", `NHL_${TODAY}_BOS_TOR`, "points", 0.5, "DraftKings", -140, +116],
  ["brad-marchand", `NHL_${TODAY}_BOS_TOR`, "assists", 0.5, "FanDuel", -155, +127],
  ["charlie-coyle", `NHL_${TODAY}_BOS_TOR`, "points", 0.5, "DraftKings", -165, +136],
  ["charlie-coyle", `NHL_${TODAY}_BOS_TOR`, "shots_on_goal", 2.5, "FanDuel", -120, -102],
  ["auston-matthews", `NHL_${TODAY}_BOS_TOR`, "points", 1.5, "DraftKings", -115, -105],
  ["auston-matthews", `NHL_${TODAY}_BOS_TOR`, "shots_on_goal", 4.5, "FanDuel", -128, +106],
  ["auston-matthews", `NHL_${TODAY}_BOS_TOR`, "assists", 0.5, "BetMGM", -160, +132],
  ["william-nylander", `NHL_${TODAY}_BOS_TOR`, "points", 1.5, "DraftKings", -108, -112],
  ["william-nylander", `NHL_${TODAY}_BOS_TOR`, "shots_on_goal", 3.5, "FanDuel", -122, +100],
  ["mitch-marner", `NHL_${TODAY}_BOS_TOR`, "assists", 0.5, "DraftKings", -158, +130],
  ["mitch-marner", `NHL_${TODAY}_BOS_TOR`, "points", 1.5, "FanDuel", -112, -108],

  // NYR vs PHI
  ["artemi-panarin", `NHL_${TODAY}_NYR_PHI`, "points", 1.5, "DraftKings", -120, -100],
  ["artemi-panarin", `NHL_${TODAY}_NYR_PHI`, "assists", 0.5, "FanDuel", -175, +145],
  ["artemi-panarin", `NHL_${TODAY}_NYR_PHI`, "shots_on_goal", 3.5, "BetMGM", -128, +106],
  ["mika-zibanejad", `NHL_${TODAY}_NYR_PHI`, "points", 1.5, "DraftKings", -118, -102],
  ["mika-zibanejad", `NHL_${TODAY}_NYR_PHI`, "shots_on_goal", 3.5, "FanDuel", -115, -105],
  ["chris-kreider", `NHL_${TODAY}_NYR_PHI`, "shots_on_goal", 3.5, "DraftKings", -130, +108],
  ["chris-kreider", `NHL_${TODAY}_NYR_PHI`, "points", 0.5, "FanDuel", -158, +130],
  ["travis-konecny", `NHL_${TODAY}_NYR_PHI`, "points", 1.5, "DraftKings", -110, -110],
  ["travis-konecny", `NHL_${TODAY}_NYR_PHI`, "shots_on_goal", 3.5, "FanDuel", -115, -105],
  ["sean-couturier", `NHL_${TODAY}_NYR_PHI`, "points", 0.5, "DraftKings", -145, +120],
  ["sean-couturier", `NHL_${TODAY}_NYR_PHI`, "assists", 0.5, "FanDuel", +105, -125],

  // COL vs VGK
  ["nathan-mackinnon", `NHL_${TODAY}_COL_VGK`, "points", 1.5, "DraftKings", -140, +116],
  ["nathan-mackinnon", `NHL_${TODAY}_COL_VGK`, "assists", 1.5, "FanDuel", -120, -100],
  ["nathan-mackinnon", `NHL_${TODAY}_COL_VGK`, "shots_on_goal", 4.5, "BetMGM", -135, +113],
  ["mikko-rantanen", `NHL_${TODAY}_COL_VGK`, "points", 1.5, "DraftKings", -115, -105],
  ["mikko-rantanen", `NHL_${TODAY}_COL_VGK`, "shots_on_goal", 4.5, "FanDuel", -118, -102],
  ["cale-makar", `NHL_${TODAY}_COL_VGK`, "points", 1.5, "DraftKings", -108, -112],
  ["cale-makar", `NHL_${TODAY}_COL_VGK`, "assists", 0.5, "FanDuel", -175, +145],
  ["jack-eichel", `NHL_${TODAY}_COL_VGK`, "points", 1.5, "DraftKings", -118, -102],
  ["jack-eichel", `NHL_${TODAY}_COL_VGK`, "shots_on_goal", 4.5, "BetMGM", -120, -100],
  ["mark-stone", `NHL_${TODAY}_COL_VGK`, "points", 1.5, "DraftKings", -105, -115],
  ["mark-stone", `NHL_${TODAY}_COL_VGK`, "assists", 0.5, "FanDuel", -145, +120],

  // EDM vs CGY
  ["connor-mcdavid", `NHL_${TODAY}_EDM_CGY`, "points", 1.5, "DraftKings", -160, +132],
  ["connor-mcdavid", `NHL_${TODAY}_EDM_CGY`, "assists", 1.5, "FanDuel", -130, +108],
  ["connor-mcdavid", `NHL_${TODAY}_EDM_CGY`, "shots_on_goal", 4.5, "BetMGM", -135, +113],
  ["leon-draisaitl", `NHL_${TODAY}_EDM_CGY`, "points", 1.5, "DraftKings", -145, +120],
  ["leon-draisaitl", `NHL_${TODAY}_EDM_CGY`, "shots_on_goal", 4.5, "FanDuel", -125, +104],
  ["zach-hyman", `NHL_${TODAY}_EDM_CGY`, "shots_on_goal", 2.5, "DraftKings", -138, +115],
  ["zach-hyman", `NHL_${TODAY}_EDM_CGY`, "points", 0.5, "FanDuel", -162, +134],
  ["nazem-kadri", `NHL_${TODAY}_EDM_CGY`, "points", 1.5, "DraftKings", -108, -112],
  ["nazem-kadri", `NHL_${TODAY}_EDM_CGY`, "shots_on_goal", 3.5, "FanDuel", -112, -108],
  ["jonathan-huberdeau", `NHL_${TODAY}_EDM_CGY`, "points", 1.5, "DraftKings", -110, -110],
  ["jonathan-huberdeau", `NHL_${TODAY}_EDM_CGY`, "assists", 0.5, "BetMGM", -155, +128],
];

// Map player → game info
const PLAYER_GAME_MAP: Record<string, { eventId: string; opponent: string; opponentAbbr: string; homeAway: "home" | "away" }> = {
  "david-pastrnak": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Toronto Maple Leafs", opponentAbbr: "TOR", homeAway: "away" },
  "brad-marchand": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Toronto Maple Leafs", opponentAbbr: "TOR", homeAway: "away" },
  "charlie-coyle": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Toronto Maple Leafs", opponentAbbr: "TOR", homeAway: "away" },
  "auston-matthews": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Boston Bruins", opponentAbbr: "BOS", homeAway: "home" },
  "william-nylander": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Boston Bruins", opponentAbbr: "BOS", homeAway: "home" },
  "mitch-marner": { eventId: `NHL_${TODAY}_BOS_TOR`, opponent: "Boston Bruins", opponentAbbr: "BOS", homeAway: "home" },
  "artemi-panarin": { eventId: `NHL_${TODAY}_NYR_PHI`, opponent: "Philadelphia Flyers", opponentAbbr: "PHI", homeAway: "away" },
  "mika-zibanejad": { eventId: `NHL_${TODAY}_NYR_PHI`, opponent: "Philadelphia Flyers", opponentAbbr: "PHI", homeAway: "away" },
  "chris-kreider": { eventId: `NHL_${TODAY}_NYR_PHI`, opponent: "Philadelphia Flyers", opponentAbbr: "PHI", homeAway: "away" },
  "travis-konecny": { eventId: `NHL_${TODAY}_NYR_PHI`, opponent: "New York Rangers", opponentAbbr: "NYR", homeAway: "home" },
  "sean-couturier": { eventId: `NHL_${TODAY}_NYR_PHI`, opponent: "New York Rangers", opponentAbbr: "NYR", homeAway: "home" },
  "nathan-mackinnon": { eventId: `NHL_${TODAY}_COL_VGK`, opponent: "Vegas Golden Knights", opponentAbbr: "VGK", homeAway: "away" },
  "mikko-rantanen": { eventId: `NHL_${TODAY}_COL_VGK`, opponent: "Vegas Golden Knights", opponentAbbr: "VGK", homeAway: "away" },
  "cale-makar": { eventId: `NHL_${TODAY}_COL_VGK`, opponent: "Vegas Golden Knights", opponentAbbr: "VGK", homeAway: "away" },
  "jack-eichel": { eventId: `NHL_${TODAY}_COL_VGK`, opponent: "Colorado Avalanche", opponentAbbr: "COL", homeAway: "home" },
  "mark-stone": { eventId: `NHL_${TODAY}_COL_VGK`, opponent: "Colorado Avalanche", opponentAbbr: "COL", homeAway: "home" },
  "connor-mcdavid": { eventId: `NHL_${TODAY}_EDM_CGY`, opponent: "Calgary Flames", opponentAbbr: "CGY", homeAway: "away" },
  "leon-draisaitl": { eventId: `NHL_${TODAY}_EDM_CGY`, opponent: "Calgary Flames", opponentAbbr: "CGY", homeAway: "away" },
  "zach-hyman": { eventId: `NHL_${TODAY}_EDM_CGY`, opponent: "Calgary Flames", opponentAbbr: "CGY", homeAway: "away" },
  "nazem-kadri": { eventId: `NHL_${TODAY}_EDM_CGY`, opponent: "Edmonton Oilers", opponentAbbr: "EDM", homeAway: "home" },
  "jonathan-huberdeau": { eventId: `NHL_${TODAY}_EDM_CGY`, opponent: "Edmonton Oilers", opponentAbbr: "EDM", homeAway: "home" },
};

function getDateFromOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// Opponents for historic logs
const LOG_OPPONENTS = ["BOS","TOR","NYR","MTL","OTT","BUF","DET","CBJ","PIT","WSH","PHI","NJD","CAR","FLA","TBL","NSH","CHI","STL","MIN","WPG","ARI","SJS","ANA","LAK","SEA","VAN","CGY","EDM","COL","DAL"];

export async function seedNHLData() {
  // Upsert sport
  await db.insert(sportsTable).values(NHL_SPORTS).onConflictDoUpdate({
    target: sportsTable.id,
    set: { name: NHL_SPORTS.name, active: NHL_SPORTS.active, markets: NHL_SPORTS.markets },
  });

  // Upsert games
  for (const game of GAMES) {
    await db.insert(gamesTable).values(game).onConflictDoUpdate({
      target: gamesTable.event_id,
      set: { status: game.status, home_goalie: game.home_goalie, away_goalie: game.away_goalie, updated_at: new Date() },
    });
  }

  // Upsert players
  for (const player of PLAYERS) {
    await db.insert(playersTable).values(player).onConflictDoUpdate({
      target: playersTable.player_slug,
      set: { team: player.team, line_assignment: player.line_assignment, pp_line: player.pp_line, updated_at: new Date() },
    });
  }

  // Upsert game logs
  for (const [playerSlug, logs] of Object.entries(PLAYER_GAME_LOG_DATA)) {
    const playerInfo = PLAYERS.find(p => p.player_slug === playerSlug);
    if (!playerInfo) continue;

    const gameInfo = PLAYER_GAME_MAP[playerSlug];
    if (!gameInfo) continue;

    // Clear existing logs for this player/sport combo first (to avoid duplication on re-seed)
    // We'll do soft-insert via unique composite (player_slug, game_date)
    for (let i = 0; i < logs.length; i++) {
      const [goals, assists, shots_on_goal, toi, pp_toi, plus_minus, daysAgo] = logs[i];
      const gameDate = getDateFromOffset(daysAgo);
      const opponentIdx = (i + playerSlug.charCodeAt(0)) % LOG_OPPONENTS.length;
      const opp = LOG_OPPONENTS[opponentIdx];
      const ha = i % 2 === 0 ? "home" : "away";
      const result = (goals + assists) > 1 ? "W" : goals + assists === 0 && i % 3 === 0 ? "L" : "W";

      try {
        await db.insert(playerGameLogsTable).values({
          player_slug: playerSlug,
          sport: "NHL",
          game_date: gameDate,
          opponent: opp,
          opponent_abbr: opp,
          home_away: ha,
          result,
          goals,
          assists,
          points: goals + assists,
          shots_on_goal,
          toi,
          pp_toi,
          plus_minus,
        }).onConflictDoNothing();
      } catch {
        // ignore duplicate logs
      }
    }
  }

  // Upsert props
  for (const [playerSlug, eventId, market, line, sportsbook, overOdds, underOdds] of PROPS_DATA) {
    const playerInfo = PLAYERS.find(p => p.player_slug === playerSlug);
    const gameInfo = PLAYER_GAME_MAP[playerSlug];
    if (!playerInfo || !gameInfo) continue;

    await db.insert(propsTable).values({
      sport: "NHL",
      event_id: eventId,
      game_date: TODAY,
      player_slug: playerSlug,
      player_name: playerInfo.player_name,
      team: playerInfo.team,
      team_abbr: playerInfo.team_abbr,
      opponent: gameInfo.opponent,
      opponent_abbr: gameInfo.opponentAbbr,
      market,
      line,
      sportsbook,
      over_odds: overOdds,
      under_odds: underOdds,
      home_away: gameInfo.homeAway,
      is_back_to_back: false,
    }).onConflictDoNothing();
  }

  return {
    games: GAMES.length,
    players: PLAYERS.length,
    props: PROPS_DATA.length,
  };
}

export { OPPONENT_ADJUSTMENTS, PLAYER_GAME_MAP };
