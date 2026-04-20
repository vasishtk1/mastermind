import SwiftUI

struct JournalHomeView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore
    @State private var activeCaptureKind: JournalEntryKind?
    @State private var expandedDirectiveID: String?
    @State private var sessionDirective: ClinicianDirective?

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 18) {
                        headerCard
                        quickActionsCard
                        directivesSection
                        realtimeMonitoringSection
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                }
                .refreshable {
                    await env.refreshDirectives()
                }
            }
            .navigationTitle("MasterMind")
            .navigationBarTitleDisplayMode(.large)
            .task {
                await env.refreshDirectives()
            }
            .sheet(item: $activeCaptureKind) { kind in
                NavigationStack {
                    JournalCaptureView(env: env, store: store, initialKind: kind, lockKindSelection: true)
                        .id(kind.rawValue)
                }
            }
            .sheet(item: $sessionDirective) { directive in
                DirectiveSessionView(
                    env: env,
                    store: store,
                    directive: directive,
                    onCompleted: {}
                )
            }
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(greetingLine)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(EmberTheme.textPrimary)
                        Text(subhead)
                            .font(.subheadline)
                            .foregroundStyle(EmberTheme.textSecondary)
                    }
                    Spacer()
                    statusBadge
                }
                Divider().overlay(EmberTheme.cardBorder)
                HStack(spacing: 16) {
                    headerStat(value: "\(store.sessions.count)", label: "Journal entries")
                    Divider().frame(width: 1, height: 28).overlay(EmberTheme.cardBorder)
                    headerStat(value: "\(unreadDirectives.count)", label: "New directives")
                    Divider().frame(width: 1, height: 28).overlay(EmberTheme.cardBorder)
                    headerStat(value: lastSyncShort, label: "Last sync")
                }
            }
        }
    }

    private func headerStat(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(EmberTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusBadge: some View {
        let count = unreadDirectives.count
        return HStack(spacing: 6) {
            Circle()
                .fill(count > 0 ? EmberTheme.accent : Color.green.opacity(0.7))
                .frame(width: 8, height: 8)
            Text(count > 0 ? "\(count) new" : "All clear")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.55))
                .overlay(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
        )
    }

    // MARK: - Quick actions

    private var quickActionsCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 12) {
                sectionHeader(title: "Start a check-in", subtitle: "Your clinician sees the biometrics, not the recording.")
                HStack(spacing: 12) {
                    Button {
                        activeCaptureKind = .video
                    } label: {
                        actionPill(title: "Video", subtitle: "Face + voice", systemName: "video.fill")
                    }
                    .buttonStyle(.plain)
                    Button {
                        activeCaptureKind = .voice
                    } label: {
                        actionPill(title: "Voice", subtitle: "Audio only", systemName: "waveform")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Directives

    private var directivesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader(title: "Directives from your care team", subtitle: "Guidance deployed by Dr. Raman.")
                Spacer()
                if env.directivesLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(EmberTheme.accent)
                } else {
                    Button {
                        Task { await env.refreshDirectives() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(EmberTheme.accent)
                            .padding(6)
                            .background(Circle().fill(EmberTheme.accentMuted))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Refresh directives")
                }
            }
            .padding(.horizontal, 4)

            if activeDirectives.isEmpty {
                emptyDirectivesCard
            } else {
                VStack(spacing: 12) {
                    ForEach(activeDirectives) { directive in
                        DirectiveCard(
                            directive: directive,
                            isExpanded: expandedDirectiveID == directive.id,
                            onToggleExpand: {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    expandedDirectiveID = expandedDirectiveID == directive.id ? nil : directive.id
                                }
                            },
                            onBegin: {
                                sessionDirective = directive
                            },
                            onAcknowledge: {
                                Task { await env.acknowledgeDirective(directive) }
                            }
                        )
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                }
                .animation(.easeInOut(duration: 0.25), value: activeDirectives.map { $0.id })
            }

            if let err = env.directivesError {
                Text(err)
                    .font(.caption2)
                    .foregroundStyle(EmberTheme.danger.opacity(0.8))
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
            }
        }
    }

    // MARK: - Real-time monitoring

    private var realtimeMonitoringSection: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    monitoringIcon
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text("Real-time monitoring")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textPrimary)
                            if env.passiveMonitoringActive {
                                liveBadge
                            }
                            if recentSignalConfirmationVisible {
                                signalSentChip
                            }
                        }
                        Text(monitoringSubtitle)
                            .font(.caption)
                            .foregroundStyle(EmberTheme.textSecondary)
                    }
                    Spacer(minLength: 0)
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { env.passiveMonitoringEnabled },
                            set: { env.setPassiveMonitoringEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    .tint(EmberTheme.accent)
                    .disabled(env.passiveMonitoringStarting)
                }

                if let metric = latestDirectiveMetric {
                    tunableMetricRow(metric)
                }

                if env.passiveMonitoringActive {
                    monitoringScoreBar
                }

                VStack(spacing: 8) {
                    HStack(spacing: 16) {
                        monitoringStat(
                            value: monitoringLastDetectionLabel,
                            label: "Last detection",
                            hint: "When Ember last flagged a moment to your clinician."
                        )
                        Divider().frame(width: 1, height: 40).overlay(EmberTheme.cardBorder)
                        monitoringStat(
                            value: "\(env.passiveIncidentCount)",
                            label: "Signals sent",
                            hint: "Passive incidents shared with Dr. Raman this session."
                        )
                    }
                }

                Button {
                    env.simulatePassiveDetection()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "bolt.fill")
                        Text("Send a test signal")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EmberTheme.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(
                        Capsule()
                            .fill(EmberTheme.accentMuted)
                            .overlay(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
                    )
                }
                .buttonStyle(.plain)

                if let err = env.passiveMonitoringError {
                    Text(err)
                        .font(.caption2)
                        .foregroundStyle(EmberTheme.danger.opacity(0.85))
                }
            }
        }
    }

    /// True for ~4 s after the most recent passive detection so the UI
    /// can show a "Signal sent" confirmation chip. Using `timeIntervalSinceNow`
    /// inside a computed var means SwiftUI only re-evaluates when state
    /// flips (toggle, detection); the chip will still fade on the next
    /// re-render which is fine for the demo.
    private var recentSignalConfirmationVisible: Bool {
        guard let when = env.lastPassiveDetectionAt else { return false }
        return Date().timeIntervalSince(when) < 4
    }

    private var signalSentChip: some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 10, weight: .bold))
            Text("Signal sent")
                .font(.system(size: 9, weight: .bold))
                .tracking(0.6)
        }
        .foregroundStyle(Color.green.opacity(0.9))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color.green.opacity(0.12)))
    }

    private var monitoringIcon: some View {
        Image(systemName: env.passiveMonitoringActive ? "waveform.badge.mic" : "ear")
            .font(.headline)
            .foregroundStyle(EmberTheme.accent)
            .frame(width: 36, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(EmberTheme.accentMuted)
            )
    }

    private var liveBadge: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.green)
                .frame(width: 6, height: 6)
            Text("LIVE")
                .font(.system(size: 9, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(Color.green.opacity(0.9))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(
            Capsule().fill(Color.green.opacity(0.12))
        )
    }

    private func tunableMetricRow(_ metric: TunableMetricDisplay) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: "slider.horizontal.below.rectangle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(EmberTheme.accent)
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(EmberTheme.accentMuted)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text("TUNED BY DR. RAMAN")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(EmberTheme.textSecondary)
                Text(metric.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
            }
            Spacer(minLength: 6)
            Text(metric.formattedValue)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.55))
                        .overlay(Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1))
                )
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                )
        )
    }

    private var monitoringScoreBar: some View {
        let score = min(1.0, max(0.0, env.latestTripwireScore))
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Acoustic level")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                Spacer()
                Text(String(format: "%.0f%%", score * 100))
                    .font(.caption2.monospacedDigit().weight(.semibold))
                    .foregroundStyle(EmberTheme.textPrimary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Color.white.opacity(0.45))
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(score > 0.82 ? EmberTheme.danger : EmberTheme.accent)
                        .frame(width: max(2, geo.size.width * score))
                        .animation(.easeOut(duration: 0.2), value: score)
                }
            }
            .frame(height: 6)
        }
    }

    private func monitoringStat(value: String, label: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(EmberTheme.textSecondary)
            Text(hint)
                .font(.system(size: 10))
                .foregroundStyle(EmberTheme.textSecondary.opacity(0.8))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var monitoringSubtitle: String {
        if env.passiveMonitoringStarting {
            return "Starting up the on-device listener…"
        }
        if env.passiveMonitoringActive {
            return "Listening on-device. Audio stays on your phone — only summary metrics are sent to your clinician."
        }
        return "Turn on to let Ember listen for moments of distress, even when the screen is off."
    }

    private var monitoringLastDetectionLabel: String {
        guard let when = env.lastPassiveDetectionAt else { return "Never" }
        let delta = Date().timeIntervalSince(when)
        if delta < 5 { return "Just now" }
        return when.formatted(.relative(presentation: .numeric))
    }

    private var emptyDirectivesCard: some View {
        EmberCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(EmberTheme.accent)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(EmberTheme.accentMuted)
                    )
                VStack(alignment: .leading, spacing: 4) {
                    Text("No directives yet")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                    Text("When your clinician deploys a directive after reviewing a journal, it will show up here.")
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textSecondary)
                }
            }
        }
    }

    // MARK: - Helpers

    private var unreadDirectives: [ClinicianDirective] {
        env.directives.filter { ($0.acknowledged ?? false) == false }
    }

    /// Only non-acknowledged directives are shown on the home screen. As
    /// soon as the patient finishes the grounding session (or taps "Mark
    /// as read"), `env.acknowledgeDirective` flips `acknowledged = true`
    /// and the card animates out of this list.
    private var activeDirectives: [ClinicianDirective] {
        env.directives.filter { ($0.acknowledged ?? false) == false }
    }

    /// Tunable metric parsed from the most recent active directive's
    /// instructions. The web app appends a line like
    /// `[Tunable] Pitch Variance: 0.35Hz` when Dr. Raman deploys the
    /// directive — we pull it back out here and surface it above the
    /// live acoustic bar so the patient sees what the clinician is
    /// watching for.
    private var latestDirectiveMetric: TunableMetricDisplay? {
        for d in activeDirectives.sorted(by: { ($0.deployedAt ?? .distantPast) > ($1.deployedAt ?? .distantPast) }) {
            if let parsed = TunableMetricDisplay.parse(from: d.displayInstructions) {
                return parsed
            }
        }
        return nil
    }

    private var greetingLine: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning, Priya" }
        if hour < 18 { return "Good afternoon, Priya" }
        return "Good evening, Priya"
    }

    private var subhead: String {
        if unreadDirectives.isEmpty {
            return "You are doing better than you think. Take a moment to check in."
        }
        let count = unreadDirectives.count
        return "Dr. Raman shared \(count) new directive\(count == 1 ? "" : "s") for you."
    }

    private var lastSyncShort: String {
        if let d = env.profileSync.lastSync {
            return d.formatted(.relative(presentation: .numeric))
        }
        return "—"
    }

    private func sectionHeader(title: String, subtitle: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private func actionPill(title: String, subtitle: String, systemName: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemName)
                .font(.headline)
                .foregroundStyle(EmberTheme.accent)
                .frame(width: 36, height: 36)
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
}

// MARK: - Directive card

struct DirectiveCard: View {
    let directive: ClinicianDirective
    let isExpanded: Bool
    let onToggleExpand: () -> Void
    let onBegin: () -> Void
    let onAcknowledge: () -> Void

    private var protocolKind: DirectiveProtocol {
        DirectiveProtocol.from(directive.directiveType)
    }

    private var beginLabel: String {
        switch protocolKind {
        case .grounding: return "Start grounding"
        case .breathing: return "Start breathing"
        case .meditation: return "Start meditation"
        case .journaling: return "Open journal"
        case .movement: return "Start walk"
        case .social: return "Reach out"
        case .custom: return "Open directive"
        }
    }

    var body: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    icon
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(directive.displayTitle)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textPrimary)
                            if !(directive.acknowledged ?? false) {
                                Text("NEW")
                                    .font(.system(size: 9, weight: .bold))
                                    .tracking(0.8)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(EmberTheme.accent))
                            }
                        }
                        Text(secondaryLine)
                            .font(.caption)
                            .foregroundStyle(EmberTheme.textSecondary)
                    }
                    Spacer(minLength: 0)
                    Button(action: onToggleExpand) {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(EmberTheme.textSecondary)
                            .padding(8)
                            .background(
                                Circle().fill(Color.white.opacity(0.4))
                            )
                    }
                    .buttonStyle(.plain)
                }

                Text(directive.displayInstructions)
                    .font(.footnote)
                    .foregroundStyle(EmberTheme.textPrimary.opacity(0.85))
                    .lineLimit(isExpanded ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)

                if isExpanded {
                    VStack(alignment: .leading, spacing: 6) {
                        if let inc = directive.incidentId {
                            metaRow(label: "Incident", value: inc)
                        }
                        if let dt = directive.directiveType {
                            metaRow(label: "Protocol", value: dt)
                        }
                        if let when = directive.deployedAt {
                            metaRow(label: "Deployed", value: when.formatted(date: .abbreviated, time: .shortened))
                        }
                    }
                    .padding(.top, 4)
                }

                HStack(spacing: 8) {
                    Button(action: onBegin) {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text(beginLabel)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(EmberTheme.accent))
                    }
                    .buttonStyle(.plain)

                    if directive.acknowledged ?? false {
                        Label("Done", systemImage: "checkmark.seal.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.green.opacity(0.85))
                    } else {
                        Button(action: onAcknowledge) {
                            Text("Mark as read")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(EmberTheme.accent)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(
                                    Capsule().stroke(EmberTheme.cardBorder, lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
            }
        }
    }

    private var icon: some View {
        Image(systemName: iconName)
            .font(.headline)
            .foregroundStyle(EmberTheme.accent)
            .frame(width: 36, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(EmberTheme.accentMuted)
            )
    }

    private var iconName: String {
        let t = (directive.directiveType ?? directive.title).lowercased()
        if t.contains("ground") { return "leaf.fill" }
        if t.contains("breath") { return "wind" }
        if t.contains("call") || t.contains("contact") { return "phone.fill" }
        if t.contains("meditat") { return "sparkles" }
        if t.contains("walk") || t.contains("move") { return "figure.walk" }
        return "stethoscope"
    }

    private var secondaryLine: String {
        if let when = directive.deployedAt {
            return "Dr. Raman • \(when.formatted(.relative(presentation: .named)))"
        }
        return "Dr. Raman"
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(EmberTheme.textSecondary)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Tunable metric parsing

/// The patient-visible slice of a directive's `[Tunable] Label: value unit`
/// footer. The web clinician dashboard appends this line to
/// `directive.instructions` on deploy; we reflect it back on the patient
/// home screen so they can see the metric their care team has dialed in.
struct TunableMetricDisplay: Equatable {
    let label: String
    let value: Double
    let unit: String

    var formattedValue: String {
        let formatted: String
        if value == value.rounded() && abs(value) < 1_000 {
            formatted = String(Int(value))
        } else {
            formatted = String(format: "%.2f", value)
        }
        return unit.isEmpty ? formatted : "\(formatted) \(unit)"
    }

    /// Parses the last `[Tunable] <label>: <value><unit>` line out of a
    /// directive's full instructions. Returns nil when the directive
    /// predates the tunable-metric feature or the line is malformed.
    static func parse(from instructions: String) -> TunableMetricDisplay? {
        // Match `[Tunable] <label>: <number><optional whitespace><unit>`
        // Case-insensitive, allowing either `Hz`, `%`, `ms`, bare units, or
        // no unit at all. Uses the final occurrence so iterative
        // redeployments still surface the most recent value.
        let pattern = #"\[Tunable\]\s*([^:]+):\s*(-?\d+(?:\.\d+)?)\s*([^\n\r]*)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let ns = instructions as NSString
        let matches = regex.matches(in: instructions, range: NSRange(location: 0, length: ns.length))
        guard let match = matches.last, match.numberOfRanges >= 3 else { return nil }
        let label = ns.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
        let valueString = ns.substring(with: match.range(at: 2))
        guard let value = Double(valueString) else { return nil }
        let unit: String
        if match.numberOfRanges >= 4, match.range(at: 3).location != NSNotFound {
            unit = ns.substring(with: match.range(at: 3)).trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            unit = ""
        }
        return TunableMetricDisplay(label: label, value: value, unit: unit)
    }
}
