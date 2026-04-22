import SwiftUI

/// Ember iOS shell.
///
/// Xcode integration checklist:
/// - Add all `Ember/Ember/*.swift` files + `Ember/Ember-Bridging-Header.h` to an iOS App target.
/// - **Bridging Header**: `Ember/Ember-Bridging-Header.h`
/// - **Header Search Paths**: `$(SRCROOT)/../cactus/cactus`
/// - **Link** against `libcactus-device` / `libcactus-simulator` from `cactus build --apple` (outputs in `../cactus/apple/`). Do not use `cactus/cactus/build` from `cactus build --python` — that is macOS-only.
/// - **Also link** vendored `libcurl` (`../cactus/libs/curl/ios/device` or `.../simulator`) plus `Security`, `SystemConfiguration`, and `CFNetwork` — same as Cactus’s `apple/CmakeLists.txt` for iOS.
/// - **Weights**: the `Copy Cactus weights` run script copies from `../cactus/weights/` into the app bundle at build time (after `cactus download`).
/// - **API**: set `APIBaseURL` in Info.plist (`127.0.0.1` for Simulator; use your Mac’s LAN IP on device).
@main
struct EmberApp: App {
    @StateObject private var env = AppEnvironment()
    @AppStorage("mastermind_has_seen_onboarding") private var hasSeenOnboarding = false

    var body: some Scene {
        WindowGroup {
            MasterMindTabView(env: env)
                .preferredColorScheme(.light)
                .fullScreenCover(isPresented: onboardingBinding) {
                    MasterMindOnboardingView {
                        hasSeenOnboarding = true
                    }
                }
                .sheet(isPresented: $env.showActiveAssessment) {
                    ActiveAssessmentView(env: env)
                }
        }
    }

    private var onboardingBinding: Binding<Bool> {
        Binding(
            get: { !hasSeenOnboarding },
            set: { newValue in
                if !newValue {
                    hasSeenOnboarding = true
                }
            }
        )
    }
}
