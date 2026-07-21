pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running Dota 2 OMG Pick Analyzer")
}
