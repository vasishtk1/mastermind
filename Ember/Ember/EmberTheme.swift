import SwiftUI

/// Visual language aligned with the Ember web dashboard (dark shell, warm orange accent).
enum EmberTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let card = Color(red: 0.12, green: 0.12, blue: 0.14)
    static let cardBorder = Color.white.opacity(0.06)
    static let accent = Color(red: 0.95, green: 0.55, blue: 0.28)
    static let accentMuted = Color(red: 0.95, green: 0.55, blue: 0.28).opacity(0.35)
    static let textPrimary = Color(red: 0.96, green: 0.96, blue: 0.97)
    static let textSecondary = Color(red: 0.55, green: 0.56, blue: 0.58)
    static let danger = Color(red: 1.0, green: 0.42, blue: 0.38)
    static let sidebarIconInactive = Color(red: 0.45, green: 0.46, blue: 0.5)
}

struct EmberCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(EmberTheme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(EmberTheme.cardBorder, lineWidth: 1)
                    )
            )
    }
}

struct EmberPrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .foregroundStyle(enabled ? Color.black : EmberTheme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(enabled ? EmberTheme.accent : EmberTheme.card)
                    .opacity(configuration.isPressed && enabled ? 0.85 : 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(enabled ? Color.clear : EmberTheme.cardBorder, lineWidth: 1)
            )
    }
}
