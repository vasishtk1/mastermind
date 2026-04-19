import SwiftUI

/// Record microphone audio, run on-device analysis, and display metrics for manual and realtime paths.
struct LiveAudioView: View {
    @ObservedObject private var cactus = CactusManager.shared
    @ObservedObject var env: AppEnvironment
    let isBootstrapped: Bool

    @State private var isRecording = false
    @State private var status: String = "Grant mic access, tap Record, then Stop. Conversion runs in the background so Stop stays responsive."
    @State private var lastPCM: Data?
    @State private var isRunningGemma = false
    @State private var isConvertingPCM = false
    @State private var isTogglingRealtime = false

    private let capture = AudioCaptureService()

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Live capture")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(EmberTheme.textSecondary)
                            .textCase(.uppercase)
                            .tracking(0.8)

                        Text("After **Analyze manual recording**, Ember prints a metrics JSON payload to console and shows it below. Realtime monitor updates the same metrics continuously.")
                            .font(.footnote)
                            .foregroundStyle(EmberTheme.textSecondary)

                        EmberCard {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Circle()
                                        .fill(isRecording ? EmberTheme.danger : EmberTheme.textSecondary.opacity(0.4))
                                        .frame(width: 10, height: 10)
                                    Text(isRecording ? "Recording…" : (isConvertingPCM ? "Converting…" : "Idle"))
                                        .font(.headline)
                                        .foregroundStyle(EmberTheme.textPrimary)
                                }

                                HStack(spacing: 12) {
                                    Button {
                                        Task { await toggleRecord() }
                                    } label: {
                                        Text(isRecording ? "Stop" : "Record")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(EmberPrimaryButtonStyle(enabled: isBootstrapped && !isRunningGemma && !isConvertingPCM))
                                    .disabled(!isBootstrapped || isRunningGemma || isConvertingPCM)
                                }

                                if let bytes = lastPCM?.count {
                                    Text("Buffered PCM: \(bytes) bytes (16 kHz mono)")
                                        .font(.caption.monospaced())
                                        .foregroundStyle(EmberTheme.textSecondary)
                                }

                                Button {
                                    Task { await runGemma() }
                                } label: {
                                    HStack {
                                        Image(systemName: "chart.xyaxis.line")
                                        Text("Analyze manual recording")
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(EmberPrimaryButtonStyle(enabled: isBootstrapped && lastPCM != nil && !isRecording && !isRunningGemma && !isConvertingPCM))
                                .disabled(!isBootstrapped || lastPCM == nil || isRecording || isRunningGemma || isConvertingPCM)
                            }
                        }

                        EmberCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Realtime monitor (Cactus VAD)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(EmberTheme.textSecondary)

                                HStack {
                                    Circle()
                                        .fill(cactus.realtimeMonitoringEnabled ? EmberTheme.accent : EmberTheme.textSecondary.opacity(0.35))
                                        .frame(width: 10, height: 10)
                                    Text(cactus.realtimeMonitoringEnabled ? "Running" : "Stopped")
                                        .font(.headline)
                                        .foregroundStyle(EmberTheme.textPrimary)
                                }

                                HStack(spacing: 12) {
                                    Button {
                                        Task { await toggleRealtimeMonitoring() }
                                    } label: {
                                        Text(cactus.realtimeMonitoringEnabled ? "Stop realtime monitor" : "Start realtime monitor")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(EmberPrimaryButtonStyle(enabled: isBootstrapped && !isRecording && !isConvertingPCM && !isRunningGemma && !isTogglingRealtime))
                                    .disabled(!isBootstrapped || isRecording || isConvertingPCM || isRunningGemma || isTogglingRealtime)
                                }

                                Text("Chunks: \(cactus.realtimeChunksSeen) · Seq: \(cactus.realtimeMetricsSequence) · VAD: \(cactus.realtimeSpeechDetected ? "speech" : "quiet") (\(cactus.realtimeVADScore, specifier: "%.2f")) · Uploaded: \(cactus.realtimeEventsUploaded)")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(EmberTheme.textSecondary)

                                if !cactus.realtimeLastTranscript.isEmpty {
                                    Text("STT: \(cactus.realtimeLastTranscript)")
                                        .font(.caption)
                                        .foregroundStyle(EmberTheme.textSecondary)
                                        .lineLimit(3)
                                }

                                if !cactus.realtimeLastGemmaSummary.isEmpty {
                                    Text("Gemma: \(cactus.realtimeLastGemmaSummary)")
                                        .font(.caption)
                                        .foregroundStyle(EmberTheme.textSecondary)
                                        .lineLimit(3)
                                }

                                if let uploadErr = cactus.realtimeLastUploadError, !uploadErr.isEmpty {
                                    Text("Upload error: \(uploadErr)")
                                        .font(.caption)
                                        .foregroundStyle(EmberTheme.danger)
                                }

                                if !cactus.realtimeMetricsJSON.isEmpty {
                                    ScrollView {
                                        Text(cactus.realtimeMetricsJSON)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(EmberTheme.textPrimary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .textSelection(.enabled)
                                    }
                                    .frame(minHeight: 120, maxHeight: 220)
                                }

                                Text("Uses `cactus_vad` to gate chunks, then `cactus_transcribe` + Gemma parsing. Sends each voiced chunk to `/api/events` with metrics.")
                                    .font(.caption2)
                                    .foregroundStyle(EmberTheme.textSecondary)
                            }
                        }

                        Text(status)
                            .font(.footnote)
                            .foregroundStyle(EmberTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)

                        if let ok = cactus.lastGemmaEngineSuccess {
                            HStack(spacing: 8) {
                                Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundStyle(ok ? Color.green : EmberTheme.danger)
                                Text(ok ? "Gemma inference succeeded" : "Gemma inference returned success = false")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(EmberTheme.textPrimary)
                            }
                            .padding(.vertical, 4)
                        }

                        if !cactus.manualMetricsJSON.isEmpty {
                            EmberCard {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Manual recording metrics (JSON)")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(EmberTheme.textSecondary)
                                    Text("Shown here and in Xcode’s console (search “Ember][Metrics”).")
                                        .font(.caption2)
                                        .foregroundStyle(EmberTheme.textSecondary)
                                    ScrollView {
                                        Text(cactus.manualMetricsJSON)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(EmberTheme.textPrimary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .textSelection(.enabled)
                                    }
                                    .frame(minHeight: 120, maxHeight: 220)
                                }
                            }
                        }

                        if let err = cactus.lastError {
                            Text(err)
                                .font(.footnote)
                                .foregroundStyle(EmberTheme.danger)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Live")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                }
            }
            .onDisappear {
                if cactus.realtimeMonitoringEnabled {
                    cactus.stopRealtimeMonitoring()
                }
            }
        }
    }

    @MainActor
    private func toggleRecord() async {
        if isRecording {
            do {
                let fileURL = try capture.stopRecorderReturningFileURL()
                isRecording = false
                isConvertingPCM = true
                status = "Converting to 16 kHz PCM (this can take a few seconds)…"

                let pcm: Data = try await Task.detached(priority: .userInitiated) {
                    try AudioCaptureService.convertFileToPCM16kMonoInt16(url: fileURL)
                }.value

                try? FileManager.default.removeItem(at: fileURL)

                lastPCM = pcm
                isConvertingPCM = false
                status = "Captured \(pcm.count) bytes. Tap **Analyze manual recording** to compute metrics and run Gemma parsing."
            } catch {
                isRecording = false
                isConvertingPCM = false
                status = "Stop / convert failed: \(error.localizedDescription)"
            }
            return
        }

        let ok = await capture.requestPermission()
        guard ok else {
            status = "Microphone permission denied — enable in Settings → Privacy → Microphone."
            return
        }
        do {
            try capture.startRecording()
            lastPCM = nil
            isRecording = true
            status = "Recording… speak, then tap **Stop**."
        } catch {
            status = "Could not start recording: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func runGemma() async {
        guard let pcm = lastPCM, !pcm.isEmpty else { return }
        isRunningGemma = true
        defer { isRunningGemma = false }
        do {
            try await cactus.runGemmaAudioProbeAndLog(audioPCM: pcm)
            status = "Analysis finished. Metrics JSON updated in-app and printed to console. Realtime card shows live chunk metrics."
        } catch {
            status = "Gemma error: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func toggleRealtimeMonitoring() async {
        isTogglingRealtime = true
        defer { isTogglingRealtime = false }

        if cactus.realtimeMonitoringEnabled {
            cactus.stopRealtimeMonitoring()
            status = "Realtime monitor stopped."
            return
        }

        do {
            try await cactus.startRealtimeMonitoring(api: env.api, patientIdProvider: { env.patientId })
            status = "Realtime monitor running. VAD-gated chunks now compute live metrics, parse with Gemma, and upload continuously."
        } catch {
            status = "Realtime monitor failed: \(error.localizedDescription)"
        }
    }
}
