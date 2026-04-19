import SwiftUI

struct DashboardView: View {
    @ObservedObject private var cactus = CactusManager.shared
    @ObservedObject var env: AppEnvironment
    /// Set by `MainTabView` after shared `bootstrapIfNeeded`.
    let isBootstrapped: Bool
    let bootstrapStatus: String

    @State private var isRunningDemo = false
    @State private var statusLine: String = ""
    @State private var showTelemetryMonitor = false

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
            .navigationDestination(isPresented: $showTelemetryMonitor) {
                TelemetryMonitorView(env: env)
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
                HStack {
                    Text("Exhaustive telemetry pipeline")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textSecondary)
                    Spacer()
                    Text("Uptime \(env.telemetry.monitoringUptimeText)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(EmberTheme.textSecondary)
                }

                HStack(spacing: 8) {
                    Circle()
                        .fill(env.telemetry.isRunning ? EmberTheme.accent : EmberTheme.textSecondary.opacity(0.4))
                        .frame(width: 10, height: 10)
                    Text(env.telemetry.isRunning ? "Monitoring" : "Stopped")
                        .foregroundStyle(EmberTheme.textPrimary)
                        .font(.headline)
                }

                Button {
                    if env.telemetry.isRunning {
                        env.telemetry.stop()
                    } else {
                        env.telemetry.start(baseURL: env.api.baseURL)
                        showTelemetryMonitor = true
                    }
                } label: {
                    Text(env.telemetry.isRunning ? "Stop telemetry capture" : "Start telemetry capture")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(EmberPrimaryButtonStyle(enabled: true))

                if env.telemetry.isRunning {
                    Button {
                        showTelemetryMonitor = true
                    } label: {
                        Text("Open telemetry monitor")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(EmberPrimaryButtonStyle(enabled: true))
                }

                Text("Upload status: \(env.telemetry.lastUploadStatus)")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Divider().overlay(EmberTheme.cardBorder)

                telemetryFaceSection
                telemetryMotionSection
                telemetryVocalSection
                telemetryTouchSection
                telemetryEnvironmentSection

                DisclosureGroup("Raw telemetry JSON") {
                    ScrollView {
                        Text(env.telemetry.latestLiveJSON)
                            .font(.caption2.monospaced())
                            .foregroundStyle(EmberTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 120, maxHeight: 220)
                }
                .tint(EmberTheme.textPrimary)
            }
        }
    }

    private var telemetryFaceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Affective tracking (ARKit)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let face = env.telemetry.latestFaceSample {
                HStack(spacing: 10) {
                    metricTile(title: "Pitch", value: String(format: "%.1f°", face.headPitch * 180 / .pi))
                    metricTile(title: "Yaw", value: String(format: "%.1f°", face.headYaw * 180 / .pi))
                    metricTile(title: "Roll", value: String(format: "%.1f°", face.headRoll * 180 / .pi))
                }
                .frame(maxHeight: 74)

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(face.blendShapes.keys.sorted(), id: \.self) { key in
                        let value = max(0, min(1, face.blendShapes[key] ?? 0))
                        HStack(spacing: 8) {
                            Text(key)
                                .font(.caption2.monospaced())
                                .foregroundStyle(EmberTheme.textSecondary)
                                .frame(width: 130, alignment: .leading)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(0.35))
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(EmberTheme.accent.opacity(0.85))
                                        .frame(width: geo.size.width * value)
                                }
                            }
                            .frame(height: 8)
                            Text(String(format: "%.0f", value * 100))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(EmberTheme.textPrimary)
                                .frame(width: 28, alignment: .trailing)
                        }
                        .frame(height: 12)
                    }
                }
                .frame(maxHeight: 250)
            } else {
                Text("No face sample yet. Requires TrueDepth front camera + telemetry running.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var telemetryMotionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Micro-tremors (CoreMotion)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let m = env.telemetry.latestMotionSample {
                HStack(spacing: 10) {
                    metricTile(title: "X", value: String(format: "%.4f", m.userAccelerationX))
                    metricTile(title: "Y", value: String(format: "%.4f", m.userAccelerationY))
                    metricTile(title: "Z", value: String(format: "%.4f", m.userAccelerationZ))
                }
                .frame(maxHeight: 74)
                metricLine("Tremor index", String(format: "%.4f", env.telemetry.tremorIndex))
                metricLine("Attitude pitch/roll/yaw", String(format: "%.3f / %.3f / %.3f", m.attitudePitch, m.attitudeRoll, m.attitudeYaw))
                metricLine("Rotation x/y/z", String(format: "%.3f / %.3f / %.3f", m.rotationRateX, m.rotationRateY, m.rotationRateZ))
                metricLine("Gravity x/y/z", String(format: "%.3f / %.3f / %.3f", m.gravityX, m.gravityY, m.gravityZ))
                metricLine("Mag field x/y/z", String(format: "%.2f / %.2f / %.2f", m.magneticFieldX, m.magneticFieldY, m.magneticFieldZ))
                metricLine("Mag accuracy", m.magneticFieldAccuracy)
            } else {
                Text("No motion sample yet.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var telemetryVocalSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vocal prosody (44.1 kHz)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let v = env.telemetry.latestVocalSample {
                metricLine("F0 (Hz)", String(format: "%.2f", v.fundamentalFrequencyHz))
                metricLine("Jitter / Shimmer", String(format: "%.5f / %.5f", v.jitterApprox, v.shimmerApprox))
                metricLine("Spectral centroid", String(format: "%.2f", v.spectralCentroid))
                metricLine("Spectral rolloff", String(format: "%.2f", v.spectralRolloff))
                metricLine("Spectral flux", String(format: "%.5f", v.spectralFlux))
                metricLine("ZCR", String(format: "%.5f", v.zeroCrossingRate))
                metricLine("RMS", String(format: "%.5f", v.rmsEnergy))
                metricLine("Average / Peak dB", String(format: "%.2f / %.2f", v.averagePowerDb, v.peakPowerDb))
                if !v.mfcc1to13.isEmpty {
                    let mfccText = v.mfcc1to13.map { String(format: "%.2f", $0) }.joined(separator: ", ")
                    Text("MFCC 1-13: \(mfccText)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(EmberTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("No vocal sample yet.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var telemetryTouchSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tactile impulsivity")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let t = env.telemetry.latestTouchSample {
                metricLine("Phase", t.phase)
                metricLine("Point", String(format: "(%.1f, %.1f)", t.x, t.y))
                metricLine("Force", String(format: "%.3f", t.force))
                metricLine("Major radius", String(format: "%.3f ± %.3f", t.majorRadius, t.majorRadiusTolerance))
                metricLine("Tap count", "\(t.tapCount)")
                if let d = t.interTapIntervalSec {
                    metricLine("Inter-tap interval", String(format: "%.4f s", d))
                }
                if let v = t.swipeVelocityPointsPerSec {
                    metricLine("Swipe velocity", String(format: "%.2f pts/s", v))
                }
            } else {
                Text("No touch sample yet.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var telemetryEnvironmentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sensory environment")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let e = env.telemetry.latestEnvironmentSample {
                metricLine("Brightness", String(format: "%.3f", e.brightness))
                metricLine("Ambient noise dB", String(format: "%.2f dB", e.ambientNoiseDb))
            } else {
                Text("No environment sample yet.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private func metricLine(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .font(.caption2)
                .foregroundStyle(EmberTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
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
