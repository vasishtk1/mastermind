import SwiftUI
import ARKit
import SceneKit

struct TelemetryMonitorView: View {
    @ObservedObject var env: AppEnvironment

    var body: some View {
        ZStack {
            EmberTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        statusPill(env.telemetry.isRunning ? "Monitoring" : "Stopped", active: env.telemetry.isRunning)
                        Spacer()
                        Text("Uptime \(env.telemetry.monitoringUptimeText)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(EmberTheme.textSecondary)
                    }

                    TelemetryCameraPreview(session: env.telemetry.faceSessionForPreview)
                        .frame(height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(EmberTheme.cardBorder, lineWidth: 1)
                        )

                    EmberCard { faceMetricsSection }
                    EmberCard { motionMetricsSection }
                    EmberCard { vocalMetricsSection }
                    EmberCard { touchMetricsSection }
                    EmberCard { environmentMetricsSection }
                }
                .padding(16)
            }
        }
        .navigationTitle("Telemetry")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(env.telemetry.isRunning ? "Stop" : "Start") {
                    if env.telemetry.isRunning {
                        env.telemetry.stop()
                    } else {
                        env.telemetry.start(baseURL: env.api.baseURL)
                    }
                }
                .tint(EmberTheme.accent)
            }
        }
        .onDisappear {
            // Prevent lingering camera/metric overlays after leaving the monitor.
            env.telemetry.stop()
        }
    }

    private var faceMetricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Affective Tracking")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let face = env.telemetry.latestFaceSample {
                HStack(spacing: 10) {
                    metricChip("Pitch", String(format: "%.1f°", face.headPitch * 180 / .pi))
                    metricChip("Yaw", String(format: "%.1f°", face.headYaw * 180 / .pi))
                    metricChip("Roll", String(format: "%.1f°", face.headRoll * 180 / .pi))
                }
                let important = ["eyeBlinkLeft", "eyeBlinkRight", "browInnerUp", "jawOpen", "mouthSmileLeft", "mouthFrownLeft", "cheekPuff", "noseSneerLeft"]
                ForEach(important, id: \.self) { key in
                    HStack {
                        Text(key)
                            .font(.caption2.monospaced())
                            .foregroundStyle(EmberTheme.textSecondary)
                        Spacer()
                        Text(String(format: "%.0f", (face.blendShapes[key] ?? 0) * 100))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(EmberTheme.textPrimary)
                    }
                }
            } else {
                Text("Waiting for face sample…")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var motionMetricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Micro-Tremors")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let m = env.telemetry.latestMotionSample {
                HStack(spacing: 10) {
                    metricChip("X", String(format: "%.4f", m.userAccelerationX))
                    metricChip("Y", String(format: "%.4f", m.userAccelerationY))
                    metricChip("Z", String(format: "%.4f", m.userAccelerationZ))
                }
                row("Tremor index", String(format: "%.4f", env.telemetry.tremorIndex))
                row("Attitude", String(format: "%.3f / %.3f / %.3f", m.attitudePitch, m.attitudeRoll, m.attitudeYaw))
                row("Rotation", String(format: "%.3f / %.3f / %.3f", m.rotationRateX, m.rotationRateY, m.rotationRateZ))
            } else {
                Text("Waiting for motion sample…")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var vocalMetricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vocal Prosody")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let v = env.telemetry.latestVocalSample {
                row("F0", String(format: "%.2f Hz", v.fundamentalFrequencyHz))
                row("Jitter / Shimmer", String(format: "%.5f / %.5f", v.jitterApprox, v.shimmerApprox))
                row("Centroid / Rolloff", String(format: "%.1f / %.1f", v.spectralCentroid, v.spectralRolloff))
                row("Flux / ZCR", String(format: "%.5f / %.5f", v.spectralFlux, v.zeroCrossingRate))
                row("RMS", String(format: "%.5f", v.rmsEnergy))
                row("Avg / Peak dB", String(format: "%.2f / %.2f", v.averagePowerDb, v.peakPowerDb))
            } else {
                Text("Waiting for vocal sample…")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var touchMetricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tactile Impulsivity")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let t = env.telemetry.latestTouchSample {
                row("Phase", t.phase)
                row("Point", String(format: "(%.1f, %.1f)", t.x, t.y))
                row("Force", String(format: "%.3f", t.force))
                row("Tap count", "\(t.tapCount)")
                if let d = t.interTapIntervalSec { row("Inter-tap", String(format: "%.4f s", d)) }
                if let v = t.swipeVelocityPointsPerSec { row("Swipe velocity", String(format: "%.2f pts/s", v)) }
            } else {
                Text("Touch the screen to populate tactile metrics.")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var environmentMetricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sensory Environment")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            if let e = env.telemetry.latestEnvironmentSample {
                row("Brightness", String(format: "%.3f", e.brightness))
                row("Ambient noise", String(format: "%.2f dB", e.ambientNoiseDb))
            } else {
                Text("Waiting for environment sample…")
                    .font(.caption)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k)
                .font(.caption2)
                .foregroundStyle(EmberTheme.textSecondary)
            Spacer()
            Text(v)
                .font(.caption.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
        }
    }

    private func metricChip(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(EmberTheme.textSecondary)
            Text(value)
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                )
        )
    }

    private func statusPill(_ text: String, active: Bool) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(active ? Color.green : EmberTheme.textSecondary.opacity(0.4))
                .frame(width: 8, height: 8)
            Text(text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(EmberTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                )
        )
    }
}

private struct TelemetryCameraPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = true
        view.session = session
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        if uiView.session !== session {
            uiView.session = session
        }
    }

    static func dismantleUIView(_ uiView: ARSCNView, coordinator: ()) {
        uiView.session.pause()
        uiView.scene = SCNScene()
    }
}
