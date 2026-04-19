import SwiftUI

struct DashboardView: View {
    @ObservedObject private var cactus = CactusManager.shared
    @ObservedObject var env: AppEnvironment
    /// Set by `MainTabView` after shared `bootstrapIfNeeded`.
    let isBootstrapped: Bool
    let bootstrapStatus: String

    @State private var isRunningDemo = false
    @State private var statusLine: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        headerBrand
                        stateCard
                        metricsCard
                        waveformCard
                        telemetryCard
                        controlsCard
                        clinicianCard
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(EmberTheme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Monitor")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                }
            }
        }
        .tint(EmberTheme.accent)
    }

    private var headerBrand: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Clinical monitor")
                .font(.caption.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
                .textCase(.uppercase)
                .tracking(0.8)
            Text("On-device Cactus · FunctionGemma · Parakeet")
                .font(.footnote)
                .foregroundStyle(EmberTheme.textSecondary)
        }
        .padding(.bottom, 4)
    }

    private var stateCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Engine state")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                Text(cactus.mode.rawValue)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(EmberTheme.textPrimary)
                if let lastError = cactus.lastError {
                    Text(lastError)
                        .foregroundStyle(EmberTheme.danger)
                        .font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !bootstrapStatus.isEmpty {
                    Text(bootstrapStatus)
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !statusLine.isEmpty {
                    Text(statusLine)
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var metricsCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("On-device footprint (estimated)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                HStack(spacing: 12) {
                    metricTile(title: "RAM footprint", value: String(format: "%.1f MB", cactus.lastRAMFootprintMB))
                    metricTile(title: "Last inference", value: String(format: "%.0f ms", cactus.lastLatencyMs))
                }
                Text("RAM uses TASK_VM_INFO.phys_footprint. Latency reads Cactus total_time_ms from the last completion JSON.")
                    .font(.caption2)
                    .foregroundStyle(EmberTheme.textSecondary.opacity(0.85))
            }
        }
    }

    private func metricTile(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(EmberTheme.textSecondary)
            Text(value)
                .font(.title3.monospacedDigit().weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                )
        )
    }

    private var waveformCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Audio activity (mock waveform)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                MockWaveformView(isActive: cactus.mode == .listeningParakeet)
                    .frame(height: 96)
            }
        }
    }

    private var controlsCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 14) {
                TextField("Patient ID", text: $env.patientId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.black.opacity(0.35))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(EmberTheme.cardBorder, lineWidth: 1)
                            )
                    )
                    .foregroundStyle(EmberTheme.textPrimary)
                    .font(.body.monospaced())
                    .onSubmit { env.setPatientId(env.patientId) }

                Button {
                    Task { await runDistressDemo() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "bolt.heart.fill")
                        Text("Simulate distress trigger")
                    }
                }
                .buttonStyle(EmberPrimaryButtonStyle(enabled: isBootstrapped && !isRunningDemo))
                .disabled(!isBootstrapped || isRunningDemo)
            }
        }
    }

    private var telemetryCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Exhaustive telemetry pipeline")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)

                HStack(spacing: 8) {
                    Circle()
                        .fill(env.telemetry.isRunning ? Color.green : EmberTheme.textSecondary.opacity(0.4))
                        .frame(width: 10, height: 10)
                    Text(env.telemetry.isRunning ? "Running @ high frequency" : "Stopped")
                        .foregroundStyle(EmberTheme.textPrimary)
                        .font(.headline)
                }

                Button {
                    if env.telemetry.isRunning {
                        env.telemetry.stop()
                    } else {
                        env.telemetry.start(baseURL: env.api.baseURL)
                    }
                } label: {
                    Text(env.telemetry.isRunning ? "Stop telemetry capture" : "Start telemetry capture")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(EmberPrimaryButtonStyle(enabled: true))

                Text("Upload status: \(env.telemetry.lastUploadStatus)")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                ScrollView {
                    Text(env.telemetry.latestLiveJSON)
                        .font(.caption2.monospaced())
                        .foregroundStyle(EmberTheme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(minHeight: 120, maxHeight: 220)
            }
        }
    }

    private var clinicianCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Clinician profile (local)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                Text("Pitch variance threshold: \(cactus.clinicianProfile.pitchVarianceThreshold, specifier: "%.3f")")
                    .foregroundStyle(EmberTheme.textPrimary)
                Text("Grounding technique: \(cactus.clinicianProfile.requiredGroundingTechnique)")
                    .foregroundStyle(EmberTheme.textPrimary)
                if !cactus.clinicianProfile.customSystemPrompt.isEmpty {
                    Text(cactus.clinicianProfile.customSystemPrompt)
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textSecondary)
                }
                if !Bundle.main.emberBackendSyncEnabled {
                    Text("Backend profile sync is off (EmberBackendSyncEnabled = NO in Info.plist). Turn it on when FastAPI is running; on a real device set APIBaseURL to http://<your-mac-ip>:8000.")
                        .font(.caption)
                        .foregroundStyle(EmberTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let last = env.profileSync.lastSync {
                    Text("Last profile sync: \(last.formatted(date: .abbreviated, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(EmberTheme.textSecondary)
                }
                if let err = env.profileSync.lastSyncError {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(backendHint(for: err))
                            .font(.caption)
                            .foregroundStyle(EmberTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
            }
        }
    }

    private func backendHint(for error: String) -> String {
        let e = error.lowercased()
        if e.contains("could not connect") || e.contains("timed out") || e.contains("network") || e.contains("unreachable") {
            return "Backend unreachable — using local defaults. For a physical iPhone, set APIBaseURL in Info.plist to http://<your-mac-ip>:8000 (Simulator can use 127.0.0.1)."
        }
        return "Profile sync: \(error)"
    }

    private func runDistressDemo() async {
        guard !isRunningDemo else { return }
        isRunningDemo = true
        defer { isRunningDemo = false }

        do {
            let result = try await cactus.runInterventionAgent(
                triggerReason: "manual_demo_button",
                patientId: env.patientId
            )

            if let event = result.crisisEvent {
                do {
                    try await env.api.uploadEvent(event: event)
                    statusLine = "Intervention complete. Crisis event uploaded."
                } catch {
                    statusLine = "Intervention complete; upload failed (check API): \(error.localizedDescription)"
                }
            } else {
                statusLine = "Intervention complete (no log_crisis_event tool call in this run)."
            }
        } catch {
            statusLine = "Intervention failed: \(error.localizedDescription)"
        }
    }
}

private struct MockWaveformView: View {
    var isActive: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isActive)) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let barCount = 48
                let barWidth = size.width / CGFloat(barCount)
                for i in 0..<barCount {
                    let phase = t * 6.0 + Double(i) * 0.35
                    let h = (sin(phase) * 0.5 + 0.5) * Double(size.height) * 0.85 + 6
                    let rect = CGRect(
                        x: CGFloat(i) * barWidth + 1,
                        y: size.height - CGFloat(h),
                        width: max(1, barWidth - 2),
                        height: CGFloat(h)
                    )
                    let color = (isActive ? EmberTheme.accent : EmberTheme.textSecondary).opacity(0.65)
                    context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(color))
                }
            }
        }
        .accessibilityLabel("Mock audio waveform")
    }
}
