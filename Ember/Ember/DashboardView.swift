import SwiftUI

struct DashboardView: View {
    @ObservedObject private var cactus = CactusManager.shared
    @ObservedObject var env: AppEnvironment
    @State private var isBootstrapped = false
    @State private var isRunningDemo = false
    @State private var statusLine: String = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    stateCard
                    metricsCard
                    waveformCard
                    controlsCard
                    clinicianCard
                }
                .padding()
            }
            .navigationTitle("Ember")
            .task {
                await bootstrap()
                env.profileSync.start()
            }
            .onDisappear {
                env.profileSync.stop()
            }
        }
    }

    private var stateCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Engine state")
                .font(.headline)
            Text(cactus.mode.rawValue)
                .font(.title2.weight(.semibold))
            if let lastError = cactus.lastError {
                Text(lastError)
                    .foregroundStyle(.red)
                    .font(.footnote)
            }
            if !statusLine.isEmpty {
                Text(statusLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var metricsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("On-device footprint (estimated)")
                .font(.headline)
            HStack {
                metricTile(title: "RAM footprint", value: String(format: "%.1f MB", cactus.lastRAMFootprintMB))
                metricTile(title: "Last inference", value: String(format: "%.0f ms", cactus.lastLatencyMs))
            }
            Text("RAM uses `TASK_VM_INFO.phys_footprint`. Latency reads Cactus `total_time_ms` from the last completion JSON.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func metricTile(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.monospacedDigit().weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.black.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var waveformCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Audio activity (mock waveform)")
                .font(.headline)
            MockWaveformView(isActive: cactus.mode == .listeningParakeet)
                .frame(height: 96)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var controlsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Patient ID", text: $env.patientId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit { env.setPatientId(env.patientId) }

            Button {
                Task { await runDistressDemo() }
            } label: {
                Text("Simulate Distress Trigger")
                    .font(.title3.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!isBootstrapped || isRunningDemo)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var clinicianCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Clinician profile (local)")
                .font(.headline)
            Text("Pitch variance threshold: \(cactus.clinicianProfile.pitchVarianceThreshold, specifier: "%.3f")")
            Text("Grounding technique: \(cactus.clinicianProfile.requiredGroundingTechnique)")
            if !cactus.clinicianProfile.customSystemPrompt.isEmpty {
                Text(cactus.clinicianProfile.customSystemPrompt)
                    .font(.footnote)
            }
            if let last = env.profileSync.lastSync {
                Text("Last profile sync: \(last.formatted(date: .abbreviated, time: .standard))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let err = env.profileSync.lastSyncError {
                Text("Profile sync error: \(err)")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func bootstrap() async {
        do {
            try cactus.bootstrapIfNeeded(patientId: env.patientId)
            isBootstrapped = true
            cactus.lastError = nil
            statusLine = "Cactus models initialized (cloud keys stripped; `auto_handoff=false`)."
        } catch {
            isBootstrapped = false
            cactus.lastError = error.localizedDescription
            statusLine = "Bootstrap failed — add bundled weights under `weights/` resources."
        }
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
                try await env.api.uploadEvent(event: event)
                statusLine = "Intervention complete. Crisis event uploaded."
            } else {
                statusLine = "Intervention complete (no `log_crisis_event` tool call detected)."
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
                    let color = (isActive ? Color.accentColor : Color.gray).opacity(0.55)
                    context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(color))
                }
            }
        }
        .accessibilityLabel("Mock audio waveform")
    }
}
