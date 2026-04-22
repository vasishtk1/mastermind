import SwiftUI
import UIKit

/// Maps a clinician directive to the correct interactive on-device experience.
/// Each type drives a self-contained runner (timer, walkthrough, journal hand-off,
/// etc.) so patients can complete the directive without leaving the home tab.
enum DirectiveProtocol: String {
    case grounding
    case breathing
    case meditation
    case journaling
    case movement
    case social
    case custom

    static func from(_ directiveType: String?) -> DirectiveProtocol {
        let t = (directiveType ?? "").lowercased()
        if t.contains("ground") { return .grounding }
        if t.contains("breath") { return .breathing }
        if t.contains("meditat") || t.contains("mindful") { return .meditation }
        if t.contains("journ") { return .journaling }
        if t.contains("move") || t.contains("walk") || t.contains("physical") { return .movement }
        if t.contains("social") || t.contains("call") || t.contains("contact") { return .social }
        return .custom
    }

    var headline: String {
        switch self {
        case .grounding: return "Grounding 5-4-3-2-1"
        case .breathing: return "Box Breathing"
        case .meditation: return "Mindfulness Meditation"
        case .journaling: return "Reflective Journal"
        case .movement: return "Physical Movement"
        case .social: return "Social Connection"
        case .custom: return "Care Directive"
        }
    }

    var systemImage: String {
        switch self {
        case .grounding: return "leaf.fill"
        case .breathing: return "wind"
        case .meditation: return "sparkles"
        case .journaling: return "book.closed.fill"
        case .movement: return "figure.walk"
        case .social: return "person.2.wave.2.fill"
        case .custom: return "stethoscope"
        }
    }
}

struct DirectiveSessionView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore
    let directive: ClinicianDirective
    let onCompleted: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var protocolKind: DirectiveProtocol {
        DirectiveProtocol.from(directive.directiveType)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        headerCard
                        instructionsCard
                        runnerCard
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 4)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle(protocolKind.headline)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(EmberTheme.accent)
                }
            }
        }
    }

    private var headerCard: some View {
        EmberCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: protocolKind.systemImage)
                    .font(.title2)
                    .foregroundStyle(EmberTheme.accent)
                    .frame(width: 44, height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(EmberTheme.accentMuted)
                    )
                VStack(alignment: .leading, spacing: 4) {
                    Text(directive.displayTitle)
                        .font(.headline)
                        .foregroundStyle(EmberTheme.textPrimary)
                    Text("From Dr. Raman" + (directive.deployedAt.map { " • \($0.formatted(.relative(presentation: .named)))" } ?? ""))
                        .font(.caption)
                        .foregroundStyle(EmberTheme.textSecondary)
                }
                Spacer()
            }
        }
    }

    private var instructionsCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 6) {
                Text("CLINICIAN NOTE")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(EmberTheme.textSecondary)
                Text(directive.displayInstructions)
                    .font(.subheadline)
                    .foregroundStyle(EmberTheme.textPrimary.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var runnerCard: some View {
        switch protocolKind {
        case .grounding:
            GroundingRunner(onFinish: finish)
        case .breathing:
            BreathingRunner(onFinish: finish)
        case .meditation:
            TimerRunner(
                title: "Mindfulness Meditation",
                subtitle: "Find a quiet spot. Breathe naturally.",
                totalSeconds: 10 * 60,
                accentSymbol: "sparkles",
                onFinish: finish
            )
        case .movement:
            TimerRunner(
                title: "Brisk walk",
                subtitle: "Notice the temperature, sounds, surfaces.",
                totalSeconds: 15 * 60,
                accentSymbol: "figure.walk",
                onFinish: finish
            )
        case .journaling:
            JournalingHandoff(env: env, store: store, onFinish: finish)
        case .social:
            SocialConnectionRunner(onFinish: finish)
        case .custom:
            CustomDirectiveRunner(onFinish: finish)
        }
    }

    private func finish() {
        Task {
            await env.acknowledgeDirective(directive)
            onCompleted()
            await MainActor.run { dismiss() }
        }
    }
}

// MARK: - Shared session container

private struct SessionCard<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 14, content: content)
        }
    }
}

private struct PrimaryActionButton: View {
    let title: String
    let systemImage: String?
    let enabled: Bool
    let action: () -> Void

    init(title: String, systemImage: String? = nil, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.enabled = enabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
        }
        .buttonStyle(EmberPrimaryButtonStyle(enabled: enabled))
        .disabled(!enabled)
    }
}

// MARK: - Grounding 5-4-3-2-1

private struct GroundingRunner: View {
    let onFinish: () -> Void

    private let steps: [(count: Int, sense: String, prompt: String, symbol: String)] = [
        (5, "see", "Name 5 things you can see right now.", "eye.fill"),
        (4, "touch", "Name 4 things you can physically touch.", "hand.tap.fill"),
        (3, "hear", "Name 3 things you can hear.", "ear.fill"),
        (2, "smell", "Name 2 things you can smell.", "wind"),
        (1, "taste", "Name 1 thing you can taste.", "fork.knife"),
    ]
    @State private var stepIndex = 0
    @State private var entries: [String] = Array(repeating: "", count: 5)
    @FocusState private var focused: Bool

    var body: some View {
        SessionCard {
            HStack(spacing: 8) {
                stepDot(text: "\(steps[stepIndex].count)", active: true)
                Text("Sense \(stepIndex + 1) of 5 — \(steps[stepIndex].sense)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
                Image(systemName: steps[stepIndex].symbol)
                    .foregroundStyle(EmberTheme.accent)
            }

            ProgressView(value: Double(stepIndex + 1), total: Double(steps.count))
                .tint(EmberTheme.accent)

            Text(steps[stepIndex].prompt)
                .font(.title3.weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            ZStack(alignment: .topLeading) {
                if entries[stepIndex].isEmpty {
                    Text("Type freely — no one else sees this")
                        .font(.subheadline)
                        .foregroundStyle(EmberTheme.textSecondary.opacity(0.7))
                        .padding(.top, 12)
                        .padding(.leading, 14)
                }
                TextEditor(text: $entries[stepIndex])
                    .focused($focused)
                    .frame(minHeight: 110)
                    .scrollContentBackground(.hidden)
                    .padding(8)
            }
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.55))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(EmberTheme.cardBorder, lineWidth: 1)
                    )
            )

            HStack(spacing: 10) {
                if stepIndex > 0 {
                    Button {
                        focused = false
                        withAnimation(.easeInOut(duration: 0.18)) { stepIndex -= 1 }
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(EmberTheme.accent)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(
                                Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                if stepIndex < steps.count - 1 {
                    PrimaryActionButton(title: "Next sense", systemImage: "chevron.right") {
                        focused = false
                        withAnimation(.easeInOut(duration: 0.18)) { stepIndex += 1 }
                    }
                    .frame(maxWidth: 200)
                } else {
                    PrimaryActionButton(title: "I feel grounded", systemImage: "checkmark.seal.fill", action: onFinish)
                        .frame(maxWidth: 240)
                }
            }
        }
    }

    private func stepDot(text: String, active: Bool) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(active ? Color.white : EmberTheme.textSecondary)
            .frame(width: 24, height: 24)
            .background(
                Circle().fill(active ? EmberTheme.accent : Color.white.opacity(0.55))
            )
    }
}

// MARK: - Box breathing

private struct BreathingRunner: View {
    let onFinish: () -> Void

    private let phases: [(label: String, seconds: Int, scale: CGFloat)] = [
        ("Inhale", 4, 1.0),
        ("Hold", 4, 1.0),
        ("Exhale", 4, 0.55),
        ("Hold", 4, 0.55),
    ]
    private let totalRounds = 5
    @State private var roundIndex = 0
    @State private var phaseIndex = 0
    @State private var phaseRemaining = 4
    @State private var running = false
    @State private var ticker: Timer?
    @State private var circleScale: CGFloat = 0.55

    var body: some View {
        SessionCard {
            HStack {
                Label("Round \(roundIndex + 1) of \(totalRounds)", systemImage: "wind")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
                Text(running ? "Running" : "Paused")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(running ? EmberTheme.accent : EmberTheme.textSecondary)
            }

            ZStack {
                Circle()
                    .fill(EmberTheme.accentMuted)
                    .frame(width: 220, height: 220)
                    .scaleEffect(circleScale)
                    .animation(.easeInOut(duration: Double(phases[phaseIndex].seconds)), value: circleScale)
                VStack(spacing: 4) {
                    Text(phases[phaseIndex].label)
                        .font(.title.weight(.bold))
                        .foregroundStyle(EmberTheme.textPrimary)
                    Text("\(phaseRemaining)s")
                        .font(.title3.monospacedDigit())
                        .foregroundStyle(EmberTheme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)

            HStack(spacing: 10) {
                Button {
                    running ? pause() : start()
                } label: {
                    Label(running ? "Pause" : "Begin", systemImage: running ? "pause.fill" : "play.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.accent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)
                Spacer()
                PrimaryActionButton(title: "I'm done", systemImage: "checkmark.seal.fill", action: { stop(); onFinish() })
                    .frame(maxWidth: 180)
            }
        }
        .onDisappear { stop() }
    }

    private func start() {
        running = true
        circleScale = phases[phaseIndex].scale
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            tick()
        }
    }

    private func pause() {
        running = false
        ticker?.invalidate()
        ticker = nil
    }

    private func stop() {
        ticker?.invalidate()
        ticker = nil
        running = false
    }

    private func tick() {
        if phaseRemaining > 1 {
            phaseRemaining -= 1
        } else {
            advancePhase()
        }
    }

    private func advancePhase() {
        let nextPhase = (phaseIndex + 1) % phases.count
        if nextPhase == 0 {
            if roundIndex >= totalRounds - 1 {
                stop()
                onFinish()
                return
            }
            roundIndex += 1
        }
        phaseIndex = nextPhase
        phaseRemaining = phases[phaseIndex].seconds
        circleScale = phases[phaseIndex].scale
    }
}

// MARK: - Generic timer runner (meditation, walk)

private struct TimerRunner: View {
    let title: String
    let subtitle: String
    let totalSeconds: Int
    let accentSymbol: String
    let onFinish: () -> Void

    @State private var remaining: Int = 0
    @State private var running = false
    @State private var ticker: Timer?

    var body: some View {
        SessionCard {
            HStack {
                Label(title, systemImage: accentSymbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
                Text(running ? "Running" : "Paused")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(running ? EmberTheme.accent : EmberTheme.textSecondary)
            }
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(EmberTheme.textSecondary)

            VStack(spacing: 8) {
                Text(formatted(remaining == 0 ? totalSeconds : remaining))
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(EmberTheme.textPrimary)
                ProgressView(value: progress, total: 1)
                    .tint(EmberTheme.accent)
                    .frame(maxWidth: 240)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)

            HStack(spacing: 10) {
                Button {
                    if running { pause() } else { start() }
                } label: {
                    Label(running ? "Pause" : "Begin", systemImage: running ? "pause.fill" : "play.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.accent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Button {
                    stop()
                    remaining = totalSeconds
                } label: {
                    Label("Reset", systemImage: "arrow.counterclockwise")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textSecondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Spacer()
                PrimaryActionButton(title: "I'm done", systemImage: "checkmark.seal.fill", action: { stop(); onFinish() })
                    .frame(maxWidth: 160)
            }
        }
        .onAppear {
            if remaining == 0 { remaining = totalSeconds }
        }
        .onDisappear { stop() }
    }

    private var progress: Double {
        let r = remaining == 0 ? totalSeconds : remaining
        return 1.0 - (Double(r) / Double(totalSeconds))
    }

    private func start() {
        if remaining == 0 { remaining = totalSeconds }
        running = true
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            tick()
        }
    }

    private func pause() {
        running = false
        ticker?.invalidate()
        ticker = nil
    }

    private func stop() {
        ticker?.invalidate()
        ticker = nil
        running = false
    }

    private func tick() {
        if remaining > 1 { remaining -= 1 }
        else { stop(); onFinish() }
    }

    private func formatted(_ s: Int) -> String {
        let m = s / 60
        let r = s % 60
        return String(format: "%02d:%02d", m, r)
    }
}

// MARK: - Journaling hand-off

private struct JournalingHandoff: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore
    let onFinish: () -> Void
    @State private var capture: JournalEntryKind?

    var body: some View {
        SessionCard {
            HStack {
                Label("Reflective Journal", systemImage: "book.closed.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
            }
            Text("Take 10 minutes. Focus on what you noticed in your body, not why.")
                .font(.caption)
                .foregroundStyle(EmberTheme.textSecondary)

            HStack(spacing: 10) {
                tile(title: "Voice Journal", subtitle: "Audio only", symbol: "waveform") {
                    capture = .voice
                }
                tile(title: "Video Journal", subtitle: "Face + voice", symbol: "video.fill") {
                    capture = .video
                }
            }

            PrimaryActionButton(title: "Mark directive complete", systemImage: "checkmark.seal.fill", action: onFinish)
        }
        .sheet(item: $capture) { kind in
            NavigationStack {
                JournalCaptureView(env: env, store: store, initialKind: kind, lockKindSelection: true)
                    .id(kind.rawValue)
            }
        }
    }

    private func tile(title: String, subtitle: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.headline)
                    .foregroundStyle(EmberTheme.accent)
                    .frame(width: 32, height: 32)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(EmberTheme.accentMuted)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(EmberTheme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.45))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(EmberTheme.cardBorder, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Social connection

private struct SocialConnectionRunner: View {
    let onFinish: () -> Void
    @State private var contacts: [Contact] = [
        Contact(name: "Mom", phone: "5551231234"),
        Contact(name: "Dr. T (clinic)", phone: "5559876543"),
        Contact(name: "Best friend", phone: "5552223333"),
    ]

    private struct Contact: Identifiable {
        let id = UUID()
        var name: String
        var phone: String
    }

    var body: some View {
        SessionCard {
            HStack {
                Label("Reach out", systemImage: "person.2.wave.2.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
            }
            Text("Even a brief check-in counts. Pick one trusted person.")
                .font(.caption)
                .foregroundStyle(EmberTheme.textSecondary)

            VStack(spacing: 8) {
                ForEach(contacts) { contact in
                    HStack(spacing: 10) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.title3)
                            .foregroundStyle(EmberTheme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(contact.name)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textPrimary)
                            Text(contact.phone)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(EmberTheme.textSecondary)
                        }
                        Spacer()
                        actionButton(symbol: "message.fill", url: URL(string: "sms:\(contact.phone)"))
                        actionButton(symbol: "phone.fill", url: URL(string: "tel:\(contact.phone)"))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.white.opacity(0.45))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(EmberTheme.cardBorder, lineWidth: 1)
                            )
                    )
                }
            }

            PrimaryActionButton(title: "I reached out", systemImage: "checkmark.seal.fill", action: onFinish)
        }
    }

    private func actionButton(symbol: String, url: URL?) -> some View {
        Button {
            if let url, UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            }
        } label: {
            Image(systemName: symbol)
                .foregroundStyle(EmberTheme.accent)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill(EmberTheme.accentMuted)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Custom

private struct CustomDirectiveRunner: View {
    let onFinish: () -> Void
    var body: some View {
        SessionCard {
            HStack {
                Label("Care directive", systemImage: "stethoscope")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Spacer()
            }
            Text("Read your clinician's instructions above and complete them at your own pace.")
                .font(.caption)
                .foregroundStyle(EmberTheme.textSecondary)
            PrimaryActionButton(title: "Mark complete", systemImage: "checkmark.seal.fill", action: onFinish)
        }
    }
}
