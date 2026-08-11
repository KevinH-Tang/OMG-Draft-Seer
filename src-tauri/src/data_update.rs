use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const API_BASE: &str = "https://api.windrun.io/api/v2";
const SNAPSHOT_DIRECTORY: &str = "data";
const SNAPSHOT_FILE: &str = "windrun-latest.json";

#[derive(Clone, Debug, Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteAbility {
    valve_id: i32,
    english_name: String,
    short_name: String,
    owner_hero_id: Option<i32>,
    is_ultimate: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteHero {
    id: i32,
    english_name: Option<String>,
    name: Option<String>,
    primary_attribute: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum RemoteHeroes {
    List(Vec<RemoteHero>),
    Map(std::collections::HashMap<String, RemoteHero>),
}

impl RemoteHeroes {
    fn into_values(self) -> Vec<RemoteHero> {
        match self {
            Self::List(heroes) => heroes,
            Self::Map(heroes) => heroes.into_values().collect(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteStatsData {
    ability_stats: Vec<RemoteAbilityStats>,
    #[serde(default)]
    ability_valuations: std::collections::HashMap<String, f64>,
    #[serde(default)]
    patches: RemotePatches,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct RemotePatches {
    #[serde(default)]
    overall: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteAbilityStats {
    ability_id: i32,
    num_picks: u64,
    avg_pick_position: f64,
    wins: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePairsData {
    ability_pairs: Vec<RemotePairStats>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePairStats {
    ability_id_one: i32,
    ability_id_two: i32,
    num_picks: u64,
    wins: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTripletsData {
    ability_triplets: Vec<RemoteTripletStats>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTripletStats {
    ability_id_one: i32,
    ability_id_two: i32,
    ability_id_three: i32,
    num_picks: u64,
    wins: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    version: String,
    patch: String,
    generated_at: String,
    source: String,
    abilities: Vec<Ability>,
    heroes: Vec<Hero>,
    ability_stats: Vec<AbilityStats>,
    ability_valuations: std::collections::HashMap<String, f64>,
    pair_stats: Vec<PairStats>,
    triplet_stats: Vec<TripletStats>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ability {
    id: i32,
    name: String,
    short_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_hero_id: Option<i32>,
    is_ultimate: bool,
    is_hero: bool,
    icon_color: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Hero {
    id: i32,
    name: String,
    primary_attribute: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AbilityStats {
    ability_id: i32,
    picks: u64,
    avg_pick_position: f64,
    wins: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairStats {
    ability_id_one: i32,
    ability_id_two: i32,
    picks: u64,
    wins: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TripletStats {
    ability_id_one: i32,
    ability_id_two: i32,
    ability_id_three: i32,
    picks: u64,
    wins: u64,
}

fn color_for(seed: &str) -> String {
    let hash = seed.encode_utf16().fold(0_u32, |hash, character| {
        hash.wrapping_mul(31).wrapping_add(u32::from(character))
    });
    let value = format!("{hash:x}");
    let padded = format!("{value:0>6}");
    format!("#{}", &padded[..6])
}

fn normalize_attribute(attribute: Option<String>) -> String {
    match attribute.as_deref() {
        Some("str" | "agi" | "int" | "uni") => attribute.unwrap_or_default(),
        _ => "uni".to_owned(),
    }
}

fn build_snapshot(
    abilities: Vec<RemoteAbility>,
    heroes: RemoteHeroes,
    stats: RemoteStatsData,
    pairs: RemotePairsData,
    triplets: RemoteTripletsData,
    generated_at: String,
) -> Result<Snapshot, String> {
    let mut mapped_abilities = Vec::with_capacity(abilities.len());
    mapped_abilities.extend(
        abilities
            .iter()
            .filter(|ability| ability.valve_id < 0 && ability.english_name.starts_with("Hero:"))
            .map(|ability| Ability {
                id: ability.valve_id,
                name: ability
                    .english_name
                    .trim_start_matches("Hero:")
                    .trim()
                    .to_owned(),
                short_name: ability.short_name.clone(),
                owner_hero_id: None,
                is_ultimate: false,
                is_hero: true,
                icon_color: color_for(&ability.short_name),
            }),
    );
    mapped_abilities.extend(
        abilities
            .into_iter()
            .filter(|ability| ability.valve_id > 0 && !ability.english_name.is_empty())
            .map(|ability| Ability {
                id: ability.valve_id,
                name: ability.english_name,
                icon_color: color_for(&ability.short_name),
                short_name: ability.short_name,
                owner_hero_id: ability.owner_hero_id,
                is_ultimate: ability.is_ultimate.unwrap_or(false),
                is_hero: false,
            }),
    );

    let snapshot = Snapshot {
        version: format!("windrun-{generated_at}"),
        patch: stats
            .patches
            .overall
            .first()
            .cloned()
            .unwrap_or_else(|| "unknown".to_owned()),
        generated_at,
        source:
            "Windrun public API snapshot. Review source and asset licences before redistribution."
                .to_owned(),
        abilities: mapped_abilities,
        heroes: heroes
            .into_values()
            .into_iter()
            .map(|hero| Hero {
                id: hero.id,
                name: hero
                    .english_name
                    .or(hero.name)
                    .unwrap_or_else(|| format!("Hero {}", hero.id)),
                primary_attribute: normalize_attribute(hero.primary_attribute),
            })
            .collect(),
        ability_stats: stats
            .ability_stats
            .into_iter()
            .map(|entry| AbilityStats {
                ability_id: entry.ability_id,
                picks: entry.num_picks,
                avg_pick_position: entry.avg_pick_position,
                wins: entry.wins,
            })
            .collect(),
        ability_valuations: stats.ability_valuations,
        pair_stats: pairs
            .ability_pairs
            .into_iter()
            .map(|entry| PairStats {
                ability_id_one: entry.ability_id_one,
                ability_id_two: entry.ability_id_two,
                picks: entry.num_picks,
                wins: entry.wins,
            })
            .collect(),
        triplet_stats: triplets
            .ability_triplets
            .into_iter()
            .map(|entry| TripletStats {
                ability_id_one: entry.ability_id_one,
                ability_id_two: entry.ability_id_two,
                ability_id_three: entry.ability_id_three,
                picks: entry.num_picks,
                wins: entry.wins,
            })
            .collect(),
    };
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn validate_snapshot(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot.abilities.is_empty() || snapshot.ability_stats.is_empty() {
        return Err("Windrun returned an empty ability dataset".to_owned());
    }
    let mut ids = HashSet::with_capacity(snapshot.abilities.len());
    if snapshot
        .abilities
        .iter()
        .any(|ability| !ids.insert(ability.id))
    {
        return Err("Windrun returned duplicate ability IDs".to_owned());
    }
    if snapshot
        .ability_stats
        .iter()
        .any(|entry| !ids.contains(&entry.ability_id) || entry.wins > entry.picks)
    {
        return Err("Windrun returned inconsistent ability statistics".to_owned());
    }
    Ok(())
}

async fn get_json<T: DeserializeOwned>(client: &reqwest::Client, path: &str) -> Result<T, String> {
    let response = client
        .get(format!("{API_BASE}{path}"))
        .send()
        .await
        .map_err(|error| format!("Windrun {path} request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Windrun {path} returned {status}"));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| format!("Windrun {path} returned invalid JSON: {error}"))
}

pub async fn fetch_snapshot() -> Result<Snapshot, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .user_agent("OMG-Draft-Seer/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let (abilities, heroes, stats, pairs, triplets) = tokio::try_join!(
        get_json::<Envelope<Vec<RemoteAbility>>>(&client, "/static/abilities"),
        get_json::<Envelope<RemoteHeroes>>(&client, "/static/heroes"),
        get_json::<Envelope<RemoteStatsData>>(&client, "/abilities"),
        get_json::<Envelope<RemotePairsData>>(&client, "/ability-pairs"),
        get_json::<Envelope<RemoteTripletsData>>(&client, "/ability-triplets"),
    )?;
    let generated_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| error.to_string())?;
    build_snapshot(
        abilities.data,
        heroes.data,
        stats.data,
        pairs.data,
        triplets.data,
        generated_at,
    )
}

fn snapshot_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SNAPSHOT_DIRECTORY).join(SNAPSHOT_FILE)
}

pub fn load_snapshot(app_data_dir: &Path) -> Result<Option<Snapshot>, String> {
    let path = snapshot_path(app_data_dir);
    let source = match fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to read the saved Windrun snapshot: {error}"
            ))
        }
    };
    let snapshot: Snapshot = serde_json::from_str(&source)
        .map_err(|error| format!("the saved Windrun snapshot is invalid: {error}"))?;
    validate_snapshot(&snapshot)?;
    Ok(Some(snapshot))
}

pub fn save_snapshot(app_data_dir: &Path, snapshot: &Snapshot) -> Result<(), String> {
    validate_snapshot(snapshot)?;
    let path = snapshot_path(app_data_dir);
    let parent = path
        .parent()
        .ok_or_else(|| "the Windrun snapshot path has no parent".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create the snapshot directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec(snapshot)
        .map_err(|error| format!("failed to encode the Windrun snapshot: {error}"))?;
    let mut temporary_file = fs::File::create(&temporary)
        .map_err(|error| format!("failed to create the Windrun snapshot: {error}"))?;
    std::io::Write::write_all(&mut temporary_file, &encoded)
        .and_then(|_| temporary_file.sync_all())
        .map_err(|error| format!("failed to write the Windrun snapshot: {error}"))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("failed to replace the Windrun snapshot: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("failed to activate the Windrun snapshot: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_snapshot, color_for, load_snapshot, save_snapshot, validate_snapshot, Ability,
        AbilityStats, RemoteAbility, RemoteAbilityStats, RemoteHero, RemoteHeroes, RemotePairStats,
        RemotePairsData, RemotePatches, RemoteStatsData, RemoteTripletStats, RemoteTripletsData,
        Snapshot,
    };
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn snapshot() -> Snapshot {
        Snapshot {
            version: "windrun-test".to_owned(),
            patch: "7.41".to_owned(),
            generated_at: "2026-08-09T00:00:00Z".to_owned(),
            source: "test".to_owned(),
            abilities: vec![Ability {
                id: 1,
                name: "Ability".to_owned(),
                short_name: "ability".to_owned(),
                owner_hero_id: None,
                is_ultimate: false,
                is_hero: false,
                icon_color: "#000000".to_owned(),
            }],
            heroes: vec![],
            ability_stats: vec![AbilityStats {
                ability_id: 1,
                picks: 10,
                avg_pick_position: 2.0,
                wins: 5,
            }],
            ability_valuations: HashMap::new(),
            pair_stats: vec![],
            triplet_stats: vec![],
        }
    }

    #[test]
    fn matches_the_existing_color_hash() {
        assert_eq!(color_for("ability"), "#b871b5");
    }

    #[test]
    fn rejects_statistics_for_unknown_abilities() {
        let mut snapshot = snapshot();
        snapshot.ability_stats[0].ability_id = 2;
        assert_eq!(
            validate_snapshot(&snapshot),
            Err("Windrun returned inconsistent ability statistics".to_owned())
        );
    }

    #[test]
    fn maps_the_windrun_response_to_the_runtime_schema() {
        let snapshot = build_snapshot(
            vec![
                RemoteAbility {
                    valve_id: -1,
                    english_name: "Hero: Axe".to_owned(),
                    short_name: "axe".to_owned(),
                    owner_hero_id: None,
                    is_ultimate: None,
                },
                RemoteAbility {
                    valve_id: 101,
                    english_name: "Berserker's Call".to_owned(),
                    short_name: "axe_berserkers_call".to_owned(),
                    owner_hero_id: Some(2),
                    is_ultimate: Some(false),
                },
            ],
            RemoteHeroes::List(vec![RemoteHero {
                id: 2,
                english_name: Some("Axe".to_owned()),
                name: None,
                primary_attribute: Some("str".to_owned()),
            }]),
            RemoteStatsData {
                ability_stats: vec![RemoteAbilityStats {
                    ability_id: 101,
                    num_picks: 100,
                    avg_pick_position: 3.5,
                    wins: 52,
                }],
                ability_valuations: HashMap::from([("101".to_owned(), 0.2)]),
                patches: RemotePatches {
                    overall: vec!["7.41".to_owned()],
                },
            },
            RemotePairsData {
                ability_pairs: vec![RemotePairStats {
                    ability_id_one: 101,
                    ability_id_two: 102,
                    num_picks: 30,
                    wins: 18,
                }],
            },
            RemoteTripletsData {
                ability_triplets: vec![RemoteTripletStats {
                    ability_id_one: 101,
                    ability_id_two: 102,
                    ability_id_three: 103,
                    num_picks: 10,
                    wins: 7,
                }],
            },
            "2026-08-09T00:00:00Z".to_owned(),
        )
        .expect("fixture should produce a valid snapshot");

        assert_eq!(snapshot.patch, "7.41");
        assert_eq!(snapshot.abilities.len(), 2);
        assert!(snapshot.abilities[0].is_hero);
        assert_eq!(snapshot.abilities[0].name, "Axe");
        assert_eq!(snapshot.abilities[1].owner_hero_id, Some(2));
        assert_eq!(snapshot.heroes[0].primary_attribute, "str");
        assert_eq!(snapshot.ability_stats[0].picks, 100);
        assert_eq!(snapshot.pair_stats[0].wins, 18);
        assert_eq!(snapshot.triplet_stats[0].ability_id_three, 103);
    }

    #[test]
    fn saves_and_loads_the_user_snapshot() {
        let root = temporary_root();
        let expected = snapshot();

        save_snapshot(&root, &expected).expect("snapshot should save");
        let mut replacement = expected.clone();
        replacement.version = "windrun-replacement".to_owned();
        save_snapshot(&root, &replacement).expect("snapshot should be replaceable");
        let loaded = load_snapshot(&root)
            .expect("snapshot should load")
            .expect("snapshot should exist");

        assert_eq!(loaded.version, replacement.version);
        assert_eq!(loaded.ability_stats[0].ability_id, 1);
        fs::remove_dir_all(root).expect("temporary snapshot root should be removable");
    }

    fn temporary_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "omg-draft-seer-data-update-{}-{nonce}",
            std::process::id()
        ))
    }
}
