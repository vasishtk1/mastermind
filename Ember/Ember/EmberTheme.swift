import SwiftUI

enum EmberTheme {
    // MasterMind palette from provided swatch image:
    // plum, lavender, cream, sage, forest.
    static let background = Color(red: 0.95, green: 0.92, blue: 0.86) // cream
    static let card = Color.white.opacity(0.52)
    static let cardBorder = Color(red: 0.72, green: 0.67, blue: 0.75).opacity(0.35) // lavender border
    static let accent = Color(red: 0.43, green: 0.36, blue: 0.50) // plum
    static let accentMuted = accent.opacity(0.18)
    static let textPrimary = Color(red: 0.23, green: 0.21, blue: 0.28)
    static let textSecondary = Color(red: 0.34, green: 0.38, blue: 0.35) // sage-dark text
    static let danger = Color(red: 0.80, green: 0.22, blue: 0.34)
    static let sidebarIconInactive = Color(red: 0.45, green: 0.41, blue: 0.56)
}

struct EmberCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(EmberTheme.card)
                    )
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
            .foregroundStyle(enabled ? Color.white : EmberTheme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(enabled ? EmberTheme.accent : Color.white.opacity(0.45))
                    .opacity(configuration.isPressed && enabled ? 0.85 : 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(EmberTheme.cardBorder, lineWidth: enabled ? 0 : 1)
            )
    }
}
