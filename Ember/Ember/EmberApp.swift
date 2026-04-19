import SwiftUI

/// Ember iOS shell.
///
/// Xcode integration checklist:
/// - Add all `Ember/Ember/*.swift` files + `Ember/Ember-Bridging-Header.h` to an iOS App target.
/// - **Bridging Header**: `Ember/Ember-Bridging-Header.h`
/// - **Header Search Paths**: `$(SRCROOT)/../cactus/cactus`
/// - **Link** the iOS Cactus static library produced by your Cactus iOS build (`cactus build --apple` flow in the Cactus repo docs).
/// - **Copy Bundle Resources**: add `weights/gemma-4-e2b-it` and `weights/parakeet-tdt-0.6b-v3` folders (from your local `cactus/weights/...` after `cactus download`).
@main
struct EmberApp: App {
    @StateObject private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            DashboardView(env: env)
        }
    }
}
