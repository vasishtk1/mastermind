import SwiftUI

struct MasterMindOnboardingView: View {
    var onComplete: () -> Void
    @State private var page = 0

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.92, blue: 0.86),
                    Color(red: 0.90, green: 0.93, blue: 0.89),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 16) {
                HStack {
                    Text("MasterMind")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(EmberTheme.accent)
                    Spacer()
                    Text("\(page + 1)/4")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(EmberTheme.textSecondary)
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)

                TabView(selection: $page) {
                    onboardingCard(
                        title: "Welcome to MasterMind",
                        subtitle: "Your daily space for mental-health check-ins and reflection.",
                        icon: "heart.text.square.fill",
                        detail: "Capture voice or video journals whenever you need support."
                    )
                    .tag(0)

                    onboardingCard(
                        title: "Biometric Insights",
                        subtitle: "MasterMind analyzes voice and camera patterns on-device.",
                        icon: "waveform.path.ecg.rectangle.fill",
                        detail: "Gemma + Cactus summarize stress signals to support your care journey."
                    )
                    .tag(1)

                    onboardingCard(
                        title: "Clinician Connection",
                        subtitle: "Biometric summaries can be sent to your doctor.",
                        icon: "person.2.wave.2.fill",
                        detail: "You decide whether to share the full journal recording."
                    )
                    .tag(2)

                    onboardingCard(
                        title: "24/7 Support Routine",
                        subtitle: "Small daily check-ins build stronger care over time.",
                        icon: "sun.max.fill",
                        detail: "You can start from Home, Journal, or adjust your profile in Settings."
                    )
                    .tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))

                HStack(spacing: 10) {
                    if page > 0 {
                        Button("Back") {
                            withAnimation { page -= 1 }
                        }
                        .buttonStyle(.bordered)
                    }
                    Button(page == 3 ? "Get Started" : "Continue") {
                        if page == 3 {
                            onComplete()
                        } else {
                            withAnimation { page += 1 }
                        }
                    }
                    .buttonStyle(EmberPrimaryButtonStyle(enabled: true))
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
        }
    }

    private func onboardingCard(title: String, subtitle: String, icon: String, detail: String) -> some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 34))
                    .foregroundStyle(EmberTheme.accent)
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Text(subtitle)
                    .font(.body)
                    .foregroundStyle(EmberTheme.textSecondary)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }
}
