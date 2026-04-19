import SwiftUI
import UIKit

/// Root shell: bottom tab bar (interactive) + shared bootstrap.
struct MainTabView: View {
    @ObservedObject var env: AppEnvironment
    @State private var isBootstrapped = false
    @State private var bootstrapStatus: String = ""

    var body: some View {
        ZStack {
            TabView {
                DashboardView(env: env, isBootstrapped: isBootstrapped, bootstrapStatus: bootstrapStatus)
                    .tabItem {
                        Label("Monitor", systemImage: "brain.head.profile")
                    }

                LiveAudioView(env: env, isBootstrapped: isBootstrapped)
                    .tabItem {
                        Label("Live", systemImage: "waveform.path.ecg")
                    }

                EmberPlaceholderTab(
                    title: "Patients",
                    subtitle: "Patient roster and clinician profiles from your FastAPI backend.",
                    bullets: [
                        "Set APIBaseURL in Info.plist. Simulator: http://127.0.0.1:8000. Physical iPhone: http://<Mac-LAN-IP>:8000 (not localhost).",
                        "Set EmberBackendSyncEnabled to YES to poll profiles on the Monitor tab.",
                        "Start the backend (e.g. uvicorn) before enabling sync, or leave sync off for on-device-only demos."
                    ]
                )
                .tabItem {
                    Label("Patients", systemImage: "person.3.fill")
                }

                EmberPlaceholderTab(
                    title: "Audit",
                    subtitle: "Eval harness, safety checks, and model rigor (web parity) — stub in this build.",
                    bullets: [
                        "Use the Live tab for FunctionGemma JSON logging and the Monitor tab for Cactus metrics.",
                        "Full audit UI can mirror the web app when the backend exposes audit endpoints."
                    ]
                )
                .tabItem {
                    Label("Audit", systemImage: "checkmark.shield.fill")
                }
            }
            TouchTelemetryCaptureView { sample in
                Task { @MainActor in
                    env.telemetry.ingestTouch(sample)
                }
            }
            .allowsHitTesting(false)
        }
        .tint(EmberTheme.accent)
        .toolbarBackground(EmberTheme.background, for: .tabBar)
        .toolbarColorScheme(.dark, for: .tabBar)
        .onAppear(perform: styleTabBar)
        .task {
            await runBootstrap()
            env.profileSync.start()
        }
        .onDisappear {
            env.profileSync.stop()
        }
    }

    private func styleTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.10, green: 0.10, blue: 0.11, alpha: 1)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    private func runBootstrap() async {
        do {
            try CactusManager.shared.bootstrapIfNeeded(patientId: env.patientId)
            isBootstrapped = true
            CactusManager.shared.lastError = nil
            bootstrapStatus = "FunctionGemma weights loaded."
            if let n = CactusManager.shared.bootstrapNotice {
                bootstrapStatus += " " + n
            } else {
                bootstrapStatus += " Parakeet STT weights loaded."
            }
        } catch {
            isBootstrapped = false
            CactusManager.shared.lastError = error.localizedDescription
            bootstrapStatus = "Bootstrap failed — run `cactus download` for both models, then rebuild (Copy Cactus weights script)."
        }
    }
}

struct EmberPlaceholderTab: View {
    let title: String
    let subtitle: String
    var bullets: [String] = []

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 12) {
                    Text(title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(EmberTheme.textPrimary)
                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(EmberTheme.textSecondary)
                    if !bullets.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(bullets.enumerated()), id: \.offset) { _, line in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("•")
                                        .foregroundStyle(EmberTheme.accent)
                                    Text(line)
                                        .font(.footnote)
                                        .foregroundStyle(EmberTheme.textSecondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(20)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Ember")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                }
            }
        }
    }
}
