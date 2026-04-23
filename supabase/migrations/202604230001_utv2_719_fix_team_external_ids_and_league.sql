-- UTV2-719: Fix team participant external_id format mismatch and set league
-- Standardizes all team external_ids from `team:SPORT:Nickname` → `CITY_TEAM_SPORT`
-- to match the format used by players (metadata.team_external_id) and events.
-- Also sets league = sport for all teams (was NULL for all 124 records).

-- Step 1: Preserve old IDs in metadata before changing
UPDATE participants
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{legacy_external_id}',
  to_jsonb(external_id)
)
WHERE participant_type = 'team'
  AND metadata->>'legacy_external_id' IS NULL;

-- Step 2: Set league = sport for all teams
UPDATE participants
SET league = sport
WHERE participant_type = 'team'
  AND league IS NULL;

-- Step 3: Update external_ids to canonical SGO format — NBA
UPDATE participants SET external_id = 'ATLANTA_HAWKS_NBA'            WHERE external_id = 'team:NBA:Hawks';
UPDATE participants SET external_id = 'BOSTON_CELTICS_NBA'           WHERE external_id = 'team:NBA:Celtics';
UPDATE participants SET external_id = 'BROOKLYN_NETS_NBA'            WHERE external_id = 'team:NBA:Nets';
UPDATE participants SET external_id = 'CHARLOTTE_HORNETS_NBA'        WHERE external_id = 'team:NBA:Hornets';
UPDATE participants SET external_id = 'CHICAGO_BULLS_NBA'            WHERE external_id = 'team:NBA:Bulls';
UPDATE participants SET external_id = 'CLEVELAND_CAVALIERS_NBA'      WHERE external_id = 'team:NBA:Cavaliers';
UPDATE participants SET external_id = 'DALLAS_MAVERICKS_NBA'         WHERE external_id = 'team:NBA:Mavericks';
UPDATE participants SET external_id = 'DENVER_NUGGETS_NBA'           WHERE external_id = 'team:NBA:Nuggets';
UPDATE participants SET external_id = 'DETROIT_PISTONS_NBA'          WHERE external_id = 'team:NBA:Pistons';
UPDATE participants SET external_id = 'GOLDEN_STATE_WARRIORS_NBA'    WHERE external_id = 'team:NBA:Warriors';
UPDATE participants SET external_id = 'HOUSTON_ROCKETS_NBA'          WHERE external_id = 'team:NBA:Rockets';
UPDATE participants SET external_id = 'INDIANA_PACERS_NBA'           WHERE external_id = 'team:NBA:Pacers';
UPDATE participants SET external_id = 'LOS_ANGELES_CLIPPERS_NBA'     WHERE external_id = 'team:NBA:Clippers';
UPDATE participants SET external_id = 'LOS_ANGELES_LAKERS_NBA'       WHERE external_id = 'team:NBA:Lakers';
UPDATE participants SET external_id = 'MEMPHIS_GRIZZLIES_NBA'        WHERE external_id = 'team:NBA:Grizzlies';
UPDATE participants SET external_id = 'MIAMI_HEAT_NBA'               WHERE external_id = 'team:NBA:Heat';
UPDATE participants SET external_id = 'MILWAUKEE_BUCKS_NBA'          WHERE external_id = 'team:NBA:Bucks';
UPDATE participants SET external_id = 'MINNESOTA_TIMBERWOLVES_NBA'   WHERE external_id = 'team:NBA:Timberwolves';
UPDATE participants SET external_id = 'NEW_ORLEANS_PELICANS_NBA'     WHERE external_id = 'team:NBA:Pelicans';
UPDATE participants SET external_id = 'NEW_YORK_KNICKS_NBA'          WHERE external_id = 'team:NBA:Knicks';
UPDATE participants SET external_id = 'OKLAHOMA_CITY_THUNDER_NBA'    WHERE external_id = 'team:NBA:Thunder';
UPDATE participants SET external_id = 'ORLANDO_MAGIC_NBA'            WHERE external_id = 'team:NBA:Magic';
UPDATE participants SET external_id = 'PHILADELPHIA_76ERS_NBA'       WHERE external_id = 'team:NBA:Sixers';
UPDATE participants SET external_id = 'PHOENIX_SUNS_NBA'             WHERE external_id = 'team:NBA:Suns';
UPDATE participants SET external_id = 'PORTLAND_TRAIL_BLAZERS_NBA'   WHERE external_id = 'team:NBA:Trail Blazers';
UPDATE participants SET external_id = 'SACRAMENTO_KINGS_NBA'         WHERE external_id = 'team:NBA:Kings' AND sport = 'NBA';
UPDATE participants SET external_id = 'SAN_ANTONIO_SPURS_NBA'        WHERE external_id = 'team:NBA:Spurs';
UPDATE participants SET external_id = 'TORONTO_RAPTORS_NBA'          WHERE external_id = 'team:NBA:Raptors';
UPDATE participants SET external_id = 'UTAH_JAZZ_NBA'                WHERE external_id = 'team:NBA:Jazz';
UPDATE participants SET external_id = 'WASHINGTON_WIZARDS_NBA'       WHERE external_id = 'team:NBA:Wizards';

-- Step 4: MLB
UPDATE participants SET external_id = 'ARIZONA_DIAMONDBACKS_MLB'     WHERE external_id = 'team:MLB:Diamondbacks';
UPDATE participants SET external_id = 'ATLANTA_BRAVES_MLB'           WHERE external_id = 'team:MLB:Braves';
UPDATE participants SET external_id = 'BALTIMORE_ORIOLES_MLB'        WHERE external_id = 'team:MLB:Orioles';
UPDATE participants SET external_id = 'BOSTON_RED_SOX_MLB'           WHERE external_id = 'team:MLB:Red Sox';
UPDATE participants SET external_id = 'CHICAGO_CUBS_MLB'             WHERE external_id = 'team:MLB:Cubs';
UPDATE participants SET external_id = 'CHICAGO_WHITE_SOX_MLB'        WHERE external_id = 'team:MLB:White Sox';
UPDATE participants SET external_id = 'CINCINNATI_REDS_MLB'          WHERE external_id = 'team:MLB:Reds';
UPDATE participants SET external_id = 'CLEVELAND_GUARDIANS_MLB'      WHERE external_id = 'team:MLB:Guardians';
UPDATE participants SET external_id = 'COLORADO_ROCKIES_MLB'         WHERE external_id = 'team:MLB:Rockies';
UPDATE participants SET external_id = 'DETROIT_TIGERS_MLB'           WHERE external_id = 'team:MLB:Tigers';
UPDATE participants SET external_id = 'HOUSTON_ASTROS_MLB'           WHERE external_id = 'team:MLB:Astros';
UPDATE participants SET external_id = 'KANSAS_CITY_ROYALS_MLB'       WHERE external_id = 'team:MLB:Royals';
UPDATE participants SET external_id = 'LOS_ANGELES_ANGELS_MLB'       WHERE external_id = 'team:MLB:Angels';
UPDATE participants SET external_id = 'LOS_ANGELES_DODGERS_MLB'      WHERE external_id = 'team:MLB:Dodgers';
UPDATE participants SET external_id = 'MIAMI_MARLINS_MLB'            WHERE external_id = 'team:MLB:Marlins';
UPDATE participants SET external_id = 'MILWAUKEE_BREWERS_MLB'        WHERE external_id = 'team:MLB:Brewers';
UPDATE participants SET external_id = 'MINNESOTA_TWINS_MLB'          WHERE external_id = 'team:MLB:Twins';
UPDATE participants SET external_id = 'NEW_YORK_METS_MLB'            WHERE external_id = 'team:MLB:Mets';
UPDATE participants SET external_id = 'NEW_YORK_YANKEES_MLB'         WHERE external_id = 'team:MLB:Yankees';
UPDATE participants SET external_id = 'OAKLAND_ATHLETICS_MLB'        WHERE external_id = 'team:MLB:Athletics';
UPDATE participants SET external_id = 'PHILADELPHIA_PHILLIES_MLB'    WHERE external_id = 'team:MLB:Phillies';
UPDATE participants SET external_id = 'PITTSBURGH_PIRATES_MLB'       WHERE external_id = 'team:MLB:Pirates';
UPDATE participants SET external_id = 'SAN_DIEGO_PADRES_MLB'         WHERE external_id = 'team:MLB:Padres';
UPDATE participants SET external_id = 'SAN_FRANCISCO_GIANTS_MLB'     WHERE external_id = 'team:MLB:Giants' AND sport = 'MLB';
UPDATE participants SET external_id = 'SEATTLE_MARINERS_MLB'         WHERE external_id = 'team:MLB:Mariners';
UPDATE participants SET external_id = 'STLOUIS_CARDINALS_MLB'        WHERE external_id = 'team:MLB:Cardinals' AND sport = 'MLB';
UPDATE participants SET external_id = 'TAMPA_BAY_RAYS_MLB'           WHERE external_id = 'team:MLB:Rays';
UPDATE participants SET external_id = 'TEXAS_RANGERS_MLB'            WHERE external_id = 'team:MLB:Rangers' AND sport = 'MLB';
UPDATE participants SET external_id = 'TORONTO_BLUE_JAYS_MLB'        WHERE external_id = 'team:MLB:Blue Jays';
UPDATE participants SET external_id = 'WASHINGTON_NATIONALS_MLB'     WHERE external_id = 'team:MLB:Nationals';

-- Step 5: NHL
UPDATE participants SET external_id = 'ANAHEIM_DUCKS_NHL'            WHERE external_id = 'team:NHL:Ducks';
UPDATE participants SET external_id = 'BOSTON_BRUINS_NHL'            WHERE external_id = 'team:NHL:Bruins';
UPDATE participants SET external_id = 'BUFFALO_SABRES_NHL'           WHERE external_id = 'team:NHL:Sabres';
UPDATE participants SET external_id = 'CALGARY_FLAMES_NHL'           WHERE external_id = 'team:NHL:Flames';
UPDATE participants SET external_id = 'CAROLINA_HURRICANES_NHL'      WHERE external_id = 'team:NHL:Hurricanes';
UPDATE participants SET external_id = 'CHICAGO_BLACKHAWKS_NHL'       WHERE external_id = 'team:NHL:Blackhawks';
UPDATE participants SET external_id = 'COLORADO_AVALANCHE_NHL'       WHERE external_id = 'team:NHL:Avalanche';
UPDATE participants SET external_id = 'COLUMBUS_BLUE_JACKETS_NHL'    WHERE external_id = 'team:NHL:Blue Jackets';
UPDATE participants SET external_id = 'DALLAS_STARS_NHL'             WHERE external_id = 'team:NHL:Stars';
UPDATE participants SET external_id = 'DETROIT_RED_WINGS_NHL'        WHERE external_id = 'team:NHL:Red Wings';
UPDATE participants SET external_id = 'EDMONTON_OILERS_NHL'          WHERE external_id = 'team:NHL:Oilers';
UPDATE participants SET external_id = 'FLORIDA_PANTHERS_NHL'         WHERE external_id = 'team:NHL:Panthers' AND sport = 'NHL';
UPDATE participants SET external_id = 'LOS_ANGELES_KINGS_NHL'        WHERE external_id = 'team:NHL:Kings' AND sport = 'NHL';
UPDATE participants SET external_id = 'MINNESOTA_WILD_NHL'           WHERE external_id = 'team:NHL:Wild';
UPDATE participants SET external_id = 'MONTREAL_CANADIENS_NHL'       WHERE external_id = 'team:NHL:Canadiens';
UPDATE participants SET external_id = 'NASHVILLE_PREDATORS_NHL'      WHERE external_id = 'team:NHL:Predators';
UPDATE participants SET external_id = 'NEW_JERSEY_DEVILS_NHL'        WHERE external_id = 'team:NHL:Devils';
UPDATE participants SET external_id = 'NEW_YORK_ISLANDERS_NHL'       WHERE external_id = 'team:NHL:Islanders';
UPDATE participants SET external_id = 'NEW_YORK_RANGERS_NHL'         WHERE external_id = 'team:NHL:Rangers' AND sport = 'NHL';
UPDATE participants SET external_id = 'OTTAWA_SENATORS_NHL'          WHERE external_id = 'team:NHL:Senators';
UPDATE participants SET external_id = 'PHILADELPHIA_FLYERS_NHL'      WHERE external_id = 'team:NHL:Flyers';
UPDATE participants SET external_id = 'PITTSBURGH_PENGUINS_NHL'      WHERE external_id = 'team:NHL:Penguins';
UPDATE participants SET external_id = 'SAN_JOSE_SHARKS_NHL'          WHERE external_id = 'team:NHL:Sharks';
UPDATE participants SET external_id = 'SEATTLE_KRAKEN_NHL'           WHERE external_id = 'team:NHL:Kraken';
UPDATE participants SET external_id = 'ST_LOUIS_BLUES_NHL'           WHERE external_id = 'team:NHL:Blues';
UPDATE participants SET external_id = 'TAMPA_BAY_LIGHTNING_NHL'      WHERE external_id = 'team:NHL:Lightning';
UPDATE participants SET external_id = 'TORONTO_MAPLE_LEAFS_NHL'      WHERE external_id = 'team:NHL:Maple Leafs';
UPDATE participants SET external_id = 'UTAH_HOCKEY_CLUB_NHL'         WHERE external_id = 'team:NHL:Coyotes';
UPDATE participants SET external_id = 'VANCOUVER_CANUCKS_NHL'        WHERE external_id = 'team:NHL:Canucks';
UPDATE participants SET external_id = 'VEGAS_GOLDEN_KNIGHTS_NHL'     WHERE external_id = 'team:NHL:Golden Knights';
UPDATE participants SET external_id = 'WASHINGTON_CAPITALS_NHL'      WHERE external_id = 'team:NHL:Capitals';
UPDATE participants SET external_id = 'WINNIPEG_JETS_NHL'            WHERE external_id = 'team:NHL:Jets' AND sport = 'NHL';

-- Step 6: NFL
UPDATE participants SET external_id = 'ARIZONA_CARDINALS_NFL'        WHERE external_id = 'team:NFL:Cardinals';
UPDATE participants SET external_id = 'ATLANTA_FALCONS_NFL'          WHERE external_id = 'team:NFL:Falcons';
UPDATE participants SET external_id = 'BALTIMORE_RAVENS_NFL'         WHERE external_id = 'team:NFL:Ravens';
UPDATE participants SET external_id = 'BUFFALO_BILLS_NFL'            WHERE external_id = 'team:NFL:Bills';
UPDATE participants SET external_id = 'CAROLINA_PANTHERS_NFL'        WHERE external_id = 'team:NFL:Panthers' AND sport = 'NFL';
UPDATE participants SET external_id = 'CHICAGO_BEARS_NFL'            WHERE external_id = 'team:NFL:Bears';
UPDATE participants SET external_id = 'CINCINNATI_BENGALS_NFL'       WHERE external_id = 'team:NFL:Bengals';
UPDATE participants SET external_id = 'CLEVELAND_BROWNS_NFL'         WHERE external_id = 'team:NFL:Browns';
UPDATE participants SET external_id = 'DALLAS_COWBOYS_NFL'           WHERE external_id = 'team:NFL:Cowboys';
UPDATE participants SET external_id = 'DENVER_BRONCOS_NFL'           WHERE external_id = 'team:NFL:Broncos';
UPDATE participants SET external_id = 'DETROIT_LIONS_NFL'            WHERE external_id = 'team:NFL:Lions';
UPDATE participants SET external_id = 'GREEN_BAY_PACKERS_NFL'        WHERE external_id = 'team:NFL:Packers';
UPDATE participants SET external_id = 'HOUSTON_TEXANS_NFL'           WHERE external_id = 'team:NFL:Texans';
UPDATE participants SET external_id = 'INDIANAPOLIS_COLTS_NFL'       WHERE external_id = 'team:NFL:Colts';
UPDATE participants SET external_id = 'JACKSONVILLE_JAGUARS_NFL'     WHERE external_id = 'team:NFL:Jaguars';
UPDATE participants SET external_id = 'KANSAS_CITY_CHIEFS_NFL'       WHERE external_id = 'team:NFL:Chiefs';
UPDATE participants SET external_id = 'LAS_VEGAS_RAIDERS_NFL'        WHERE external_id = 'team:NFL:Raiders';
UPDATE participants SET external_id = 'LOS_ANGELES_CHARGERS_NFL'     WHERE external_id = 'team:NFL:Chargers';
UPDATE participants SET external_id = 'LOS_ANGELES_RAMS_NFL'         WHERE external_id = 'team:NFL:Rams';
UPDATE participants SET external_id = 'MIAMI_DOLPHINS_NFL'           WHERE external_id = 'team:NFL:Dolphins';
UPDATE participants SET external_id = 'MINNESOTA_VIKINGS_NFL'        WHERE external_id = 'team:NFL:Vikings';
UPDATE participants SET external_id = 'NEW_ENGLAND_PATRIOTS_NFL'     WHERE external_id = 'team:NFL:Patriots';
UPDATE participants SET external_id = 'NEW_ORLEANS_SAINTS_NFL'       WHERE external_id = 'team:NFL:Saints';
UPDATE participants SET external_id = 'NEW_YORK_GIANTS_NFL'          WHERE external_id = 'team:NFL:Giants' AND sport = 'NFL';
UPDATE participants SET external_id = 'NEW_YORK_JETS_NFL'            WHERE external_id = 'team:NFL:Jets' AND sport = 'NFL';
UPDATE participants SET external_id = 'PHILADELPHIA_EAGLES_NFL'      WHERE external_id = 'team:NFL:Eagles';
UPDATE participants SET external_id = 'PITTSBURGH_STEELERS_NFL'      WHERE external_id = 'team:NFL:Steelers';
UPDATE participants SET external_id = 'SAN_FRANCISCO_49ERS_NFL'      WHERE external_id = 'team:NFL:49ers';
UPDATE participants SET external_id = 'SEATTLE_SEAHAWKS_NFL'         WHERE external_id = 'team:NFL:Seahawks';
UPDATE participants SET external_id = 'TAMPA_BAY_BUCCANEERS_NFL'     WHERE external_id = 'team:NFL:Buccaneers';
UPDATE participants SET external_id = 'TENNESSEE_TITANS_NFL'         WHERE external_id = 'team:NFL:Titans';
UPDATE participants SET external_id = 'WASHINGTON_COMMANDERS_NFL'    WHERE external_id = 'team:NFL:Commanders';

-- Step 7: Update display_name for Utah Hockey Club (was Coyotes)
UPDATE participants
SET display_name = 'Utah Hockey Club',
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{legacy_display_name}',
      '"Coyotes"'
    )
WHERE external_id = 'UTAH_HOCKEY_CLUB_NHL';
