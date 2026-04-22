import SwiftUI
import UIKit

struct MasterMindTabView: View {
    @ObservedObject var env: AppEnvironment
    @StateObject private var store = JournalStore()

    var body: some View {
        TabView {
            JournalHomeView(env: env, store: store)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            JournalLibraryView(env: env, store: store)
                .tabItem {
                    Label("Journal", systemImage: "book.closed.fill")
                }

            MasterMindSettingsView(env: env)
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
        }
        .tint(EmberTheme.accent)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(.ultraThinMaterial, for: .tabBar)
        .onAppear(perform: styleTabBar)
        .task {
            env.startEscalationProtocolIfNeeded()
            env.profileSync.start()
        }
        .onDisappear {
            env.profileSync.stop()
        }
    }

    private func styleTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialLight)
        appearance.backgroundColor = UIColor(red: 0.95, green: 0.92, blue: 0.86, alpha: 0.55)
        appearance.shadowColor = UIColor(red: 0.43, green: 0.36, blue: 0.50, alpha: 0.16)

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}
