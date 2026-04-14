-- Team abbreviation backfill for ESPN CDN logo enrichment.
-- ESPN uses lowercase abbreviations in logo URLs:
--   https://a.espncdn.com/i/teamlogos/{sport}/500/{abbr}.png
-- This migration sets metadata.abbreviation on all team participants
-- so the team-logo-enrichment-service can resolve logos.

-- NBA (30 teams)
UPDATE participants SET metadata = metadata || '{"abbreviation":"mil"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Bucks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"chi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Bulls';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cle"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Cavaliers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bos"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Celtics';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lac"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Clippers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mem"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Grizzlies';
UPDATE participants SET metadata = metadata || '{"abbreviation":"atl"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Hawks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mia"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Heat';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cha"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Hornets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"uta"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Jazz';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sac"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Kings';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ny"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Knicks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lal"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Lakers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"orl"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Magic';
UPDATE participants SET metadata = metadata || '{"abbreviation":"dal"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Mavericks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bkn"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Nets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"den"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Nuggets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ind"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Pacers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"no"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Pelicans';
UPDATE participants SET metadata = metadata || '{"abbreviation":"det"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Pistons';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tor"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Raptors';
UPDATE participants SET metadata = metadata || '{"abbreviation":"hou"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Rockets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"phi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Sixers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sa"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Spurs';
UPDATE participants SET metadata = metadata || '{"abbreviation":"phx"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Suns';
UPDATE participants SET metadata = metadata || '{"abbreviation":"okc"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Thunder';
UPDATE participants SET metadata = metadata || '{"abbreviation":"min"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Timberwolves';
UPDATE participants SET metadata = metadata || '{"abbreviation":"por"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Trail Blazers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"gs"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Warriors';
UPDATE participants SET metadata = metadata || '{"abbreviation":"wsh"}'::jsonb WHERE participant_type = 'team' AND sport = 'NBA' AND display_name = 'Wizards';

-- MLB (30 teams)
UPDATE participants SET metadata = metadata || '{"abbreviation":"laa"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Angels';
UPDATE participants SET metadata = metadata || '{"abbreviation":"hou"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Astros';
UPDATE participants SET metadata = metadata || '{"abbreviation":"oak"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Athletics';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tor"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Blue Jays';
UPDATE participants SET metadata = metadata || '{"abbreviation":"atl"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Braves';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mil"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Brewers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"stl"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Cardinals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"chc"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Cubs';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ari"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Diamondbacks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lad"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Dodgers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sf"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Giants';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cle"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Guardians';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sea"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Mariners';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mia"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Marlins';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nym"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Mets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"wsh"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Nationals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bal"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Orioles';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sd"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Padres';
UPDATE participants SET metadata = metadata || '{"abbreviation":"phi"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Phillies';
UPDATE participants SET metadata = metadata || '{"abbreviation":"pit"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Pirates';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tex"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Rangers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tb"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Rays';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bos"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Red Sox';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cin"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Reds';
UPDATE participants SET metadata = metadata || '{"abbreviation":"col"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Rockies';
UPDATE participants SET metadata = metadata || '{"abbreviation":"kc"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Royals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"det"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Tigers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"min"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Twins';
UPDATE participants SET metadata = metadata || '{"abbreviation":"chw"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'White Sox';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nyy"}'::jsonb WHERE participant_type = 'team' AND sport = 'MLB' AND display_name = 'Yankees';

-- NFL (32 teams)
UPDATE participants SET metadata = metadata || '{"abbreviation":"ari"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Cardinals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"atl"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Falcons';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bal"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Ravens';
UPDATE participants SET metadata = metadata || '{"abbreviation":"buf"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Bills';
UPDATE participants SET metadata = metadata || '{"abbreviation":"car"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Panthers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"chi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Bears';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cin"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Bengals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cle"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Browns';
UPDATE participants SET metadata = metadata || '{"abbreviation":"dal"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Cowboys';
UPDATE participants SET metadata = metadata || '{"abbreviation":"den"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Broncos';
UPDATE participants SET metadata = metadata || '{"abbreviation":"det"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Lions';
UPDATE participants SET metadata = metadata || '{"abbreviation":"gb"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Packers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"hou"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Texans';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ind"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Colts';
UPDATE participants SET metadata = metadata || '{"abbreviation":"jax"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Jaguars';
UPDATE participants SET metadata = metadata || '{"abbreviation":"kc"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Chiefs';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lv"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Raiders';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lac"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Chargers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"lar"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Rams';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mia"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Dolphins';
UPDATE participants SET metadata = metadata || '{"abbreviation":"min"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Vikings';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ne"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Patriots';
UPDATE participants SET metadata = metadata || '{"abbreviation":"no"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Saints';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nyg"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Giants';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nyj"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Jets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"phi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Eagles';
UPDATE participants SET metadata = metadata || '{"abbreviation":"pit"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Steelers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sf"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = '49ers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sea"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Seahawks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tb"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Buccaneers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ten"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Titans';
UPDATE participants SET metadata = metadata || '{"abbreviation":"wsh"}'::jsonb WHERE participant_type = 'team' AND sport = 'NFL' AND display_name = 'Commanders';

-- NHL (32 teams)
UPDATE participants SET metadata = metadata || '{"abbreviation":"col"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Avalanche';
UPDATE participants SET metadata = metadata || '{"abbreviation":"chi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Blackhawks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cbj"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Blue Jackets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"stl"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Blues';
UPDATE participants SET metadata = metadata || '{"abbreviation":"bos"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Bruins';
UPDATE participants SET metadata = metadata || '{"abbreviation":"mtl"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Canadiens';
UPDATE participants SET metadata = metadata || '{"abbreviation":"van"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Canucks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"wsh"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Capitals';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ari"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Coyotes';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nj"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Devils';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ana"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Ducks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"cgy"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Flames';
UPDATE participants SET metadata = metadata || '{"abbreviation":"phi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Flyers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"vgk"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Golden Knights';
UPDATE participants SET metadata = metadata || '{"abbreviation":"car"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Hurricanes';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nyi"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Islanders';
UPDATE participants SET metadata = metadata || '{"abbreviation":"wpg"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Jets';
UPDATE participants SET metadata = metadata || '{"abbreviation":"la"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Kings';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sea"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Kraken';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tb"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Lightning';
UPDATE participants SET metadata = metadata || '{"abbreviation":"tor"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Maple Leafs';
UPDATE participants SET metadata = metadata || '{"abbreviation":"edm"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Oilers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"fla"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Panthers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"pit"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Penguins';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nsh"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Predators';
UPDATE participants SET metadata = metadata || '{"abbreviation":"nyr"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Rangers';
UPDATE participants SET metadata = metadata || '{"abbreviation":"det"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Red Wings';
UPDATE participants SET metadata = metadata || '{"abbreviation":"buf"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Sabres';
UPDATE participants SET metadata = metadata || '{"abbreviation":"ott"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Senators';
UPDATE participants SET metadata = metadata || '{"abbreviation":"sj"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Sharks';
UPDATE participants SET metadata = metadata || '{"abbreviation":"dal"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Stars';
UPDATE participants SET metadata = metadata || '{"abbreviation":"min"}'::jsonb WHERE participant_type = 'team' AND sport = 'NHL' AND display_name = 'Wild';
