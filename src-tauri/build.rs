use std::env;

fn main() {
    println!("cargo:rerun-if-changed=capabilities/default.json");
    println!("cargo:rerun-if-changed=capabilities/wdio.json");

    let capabilities = if env::var_os("CARGO_FEATURE_WDIO").is_some() {
        "capabilities/wdio.json"
    } else {
        "capabilities/default.json"
    };

    tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(capabilities))
        .expect("failed to generate the Tauri build context");
}
