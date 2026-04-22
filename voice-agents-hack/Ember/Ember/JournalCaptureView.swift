import SwiftUI
import AVKit

struct JournalCaptureView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore
    let initialKind: JournalEntryKind
    let lockKindSelection: Bool
    @Environment(\.dismiss) private var dismiss

    @State private var noteText: String = ""
    @State private var recordedURL: URL?
    @State private var selectedKind: JournalEntryKind
    @State private var showRecorder = false
    @State private var isVoiceRecording = false
    @State private var isAnalyzing = false
    @State private var isSharingJournal = false
    @State private var errorText: String?
    @State private var infoText: String?
    @State private var statusProgress: Double = 0
    @State private var statusTitle: String = "Idle"
    @State private var showStatusProgress = false
    @State private var previewPlayer: AVPlayer?
    @State private var showSharePrompt = false
    @State private var pendingShareFileURL: URL?
    @State private var pendingShareSessionID: UUID?
    @State private var pendingShareKind: JournalEntryKind = .video
    @State private var audioCapture = AudioCaptureService()

    init(
        env: AppEnvironment,
        store: JournalStore,
        initialKind: JournalEntryKind = .video,
        lockKindSelection: Bool = false
    ) {
        self.env = env
        self.store = store
        self.initialKind = initialKind
        self.lockKindSelection = lockKindSelection
        _selectedKind = State(initialValue: initialKind)
    }

    var body: some View {
        ZStack {
            EmberTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("New Journal Session")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(EmberTheme.textPrimary)

                    Text("Record a video or voice journal. Ember will extract biometrics and run on-device Gemma grounding guidance.")
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    TextField("Add optional context before recording...", text: $noteText, axis: .vertical)
                        .lineLimit(2...5)
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

                    if !lockKindSelection {
                        Picker("Journal type", selection: $selectedKind) {
                            ForEach(JournalEntryKind.allCases, id: \.self) { kind in
                                Text(kind == .video ? "Video" : "Voice").tag(kind)
                            }
                        }
                        .pickerStyle(.segmented)
                        .disabled(isAnalyzing || isSharingJournal || isVoiceRecording)
                    } else {
                        HStack {
                            Text("Mode")
                                .font(.caption2)
                                .foregroundStyle(EmberTheme.textSecondary)
                            Spacer()
                            Text(selectedKind == .video ? "Video Journal" : "Voice Journal")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(EmberTheme.textPrimary)
                        }
                    }

                    if selectedKind == .video {
                        Button {
                            showRecorder = true
                        } label: {
                            Text(recordedURL == nil ? "Record video journal" : "Re-record video")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(EmberPrimaryButtonStyle(enabled: !isAnalyzing && !isSharingJournal && !isVoiceRecording))
                        .disabled(isAnalyzing || isSharingJournal || isVoiceRecording)
                    } else {
                        Button {
                            if isVoiceRecording {
                                stopVoiceCaptureAndAnalyze()
                            } else {
                                Task { await startVoiceCapture() }
                            }
                        } label: {
                            Text(isVoiceRecording ? "Stop voice journal" : (recordedURL == nil ? "Start voice journal" : "Re-record voice journal"))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(EmberPrimaryButtonStyle(enabled: !isAnalyzing && !isSharingJournal))
                        .disabled(isAnalyzing || isSharingJournal)
                    }

                    if let url = recordedURL {
                        VideoPlayer(player: previewPlayer ?? AVPlayer(url: url))
                            .frame(height: selectedKind == .video ? 240 : 90)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }

                    if selectedKind == .video && (showStatusProgress || isAnalyzing || isSharingJournal) {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(statusTitle)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(EmberTheme.textPrimary)
                                Spacer()
                                Text("\(Int((statusProgress * 100).rounded()))%")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(EmberTheme.textSecondary)
                            }
                            ProgressView(value: statusProgress, total: 1)
                                .tint(EmberTheme.accent)
                                .progressViewStyle(.linear)
                        }
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                                )
                        )
                    }

                    if let errorText {
                        Text(errorText)
                            .font(.footnote)
                            .foregroundStyle(EmberTheme.danger)
                    }
                    if let infoText {
                        Text(infoText)
                            .font(.footnote)
                            .foregroundStyle(EmberTheme.textSecondary)
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle(selectedKind == .video ? "Video Journal" : "Voice Journal")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $showRecorder) {
            VideoJournalRecorderView { url in
                showRecorder = false
                handleRecorderOutput(url)
            }
            .ignoresSafeArea()
        }
        .alert("Biometrics sent to Dr. T", isPresented: $showSharePrompt) {
            Button("Not now", role: .cancel) {
                dismiss()
            }
            Button(isSharingJournal ? "Sending..." : "Send journal") {
                Task { await sendPendingJournalToClinician() }
            }
            .disabled(isSharingJournal)
        } message: {
            Text("Your biometric summary was sent successfully. Would you also like to send your \(pendingShareKind == .video ? "video" : "voice") journal recording?")
        }
        .onDisappear {
            previewPlayer?.pause()
            previewPlayer?.replaceCurrentItem(with: nil)
            previewPlayer = nil
            showStatusProgress = false
            if isVoiceRecording {
                if let url = try? audioCapture.stopRecorderReturningFileURL() {
                    try? FileManager.default.removeItem(at: url)
                }
                isVoiceRecording = false
            }
        }
        .onAppear {
            if lockKindSelection {
                selectedKind = initialKind
            }
        }
    }

    @MainActor
    private func startVoiceCapture() async {
        errorText = nil
        infoText = nil
        let granted = await audioCapture.requestPermission()
        guard granted else {
            errorText = "Microphone permission is required for voice journals."
            return
        }
        do {
            try audioCapture.startRecording()
            isVoiceRecording = true
            infoText = "Recording voice journal..."
        } catch {
            errorText = "Could not start voice recording: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func stopVoiceCaptureAndAnalyze() {
        do {
            let tempURL = try audioCapture.stopRecorderReturningFileURL()
            isVoiceRecording = false
            let fileName = try store.persistVoiceFromTemp(tempURL)
            try? FileManager.default.removeItem(at: tempURL)
            let stableURL = store.videoURL(forFileName: fileName)
            recordedURL = stableURL
            previewPlayer?.pause()
            previewPlayer = AVPlayer(url: stableURL)
            infoText = "Analyzing and saving voice journal..."
            setSystemStatus("Preparing analysis...", progress: 0.10)
            Task { await analyzeAndSave(fileName: fileName, recordedURL: stableURL, kind: .voice) }
        } catch {
            isVoiceRecording = false
            errorText = "Could not finish voice recording: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func handleRecorderOutput(_ url: URL?) {
        guard let url else { return }
        errorText = nil
        infoText = nil
        do {
            let fileName = try store.persistVideoFromTemp(url)
            let stableURL = store.videoURL(forFileName: fileName)
            recordedURL = stableURL
            previewPlayer?.pause()
            previewPlayer = AVPlayer(url: stableURL)
            infoText = "Analyzing and saving journal session..."
            setSystemStatus("Preparing analysis...", progress: 0.10)
            Task { await analyzeAndSave(fileName: fileName, recordedURL: stableURL, kind: .video) }
        } catch {
            errorText = "Could not persist captured video: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func analyzeAndSave(fileName: String, recordedURL: URL, kind: JournalEntryKind) async {
        isAnalyzing = true
        defer { isAnalyzing = false }
        errorText = nil

        do {
            if CactusManager.shared.lastError == nil {
                try CactusManager.shared.bootstrapIfNeeded(patientId: env.patientId)
            }
            setSystemStatus("Extracting biometrics...", progress: 0.25)
            let pcm: Data
            let facial: JournalTelemetryAnalyzer.FacialTelemetry
            if kind == .video {
                pcm = try JournalTelemetryAnalyzer.extractPCM16kMono(from: recordedURL)
                facial = JournalTelemetryAnalyzer.analyzeFacialStress(from: recordedURL)
            } else {
                pcm = try AudioCaptureService.convertFileToPCM16kMonoInt16(url: recordedURL)
                facial = .init(facialStressScore: 0, browFurrowScore: 0, jawTightnessScore: 0)
            }
            let audio = AudioFeatureExtractor.compute(fromPCM16LE: pcm)
            setSystemStatus("Running Gemma 4 analysis...", progress: 0.55)
            let inference = try await CactusManager.shared.runInterventionAgent(
                textInput: noteText.isEmpty ? "User recorded a journal without extra text." : noteText,
                facialStressScore: facial.facialStressScore,
                patientId: env.patientId,
                audio: audio,
                browFurrowScore: facial.browFurrowScore,
                jawTightnessScore: facial.jawTightnessScore
            )

            var biometricsSent = false
            let context: [String: Any] = [
                "patient_id": env.patientId,
                "session_id": sessionIdentifierString(kind: kind),
                "tripwire_score": env.latestTripwireScore,
                "realtime_vad_score": CactusManager.shared.realtimeVADScore,
                "realtime_speech_detected": CactusManager.shared.realtimeSpeechDetected,
                "realtime_chunks_seen": CactusManager.shared.realtimeChunksSeen,
                "realtime_events_uploaded": CactusManager.shared.realtimeEventsUploaded,
                "gemma_model_response": inference.modelResponse,
            ]
            do {
                setSystemStatus("Gemma 4 succeeded. Pushing to Convex...", progress: 0.80)
                let result = try await env.convex.ingestJournal(
                    patientId: env.patientId,
                    patientName: nil,
                    journalKind: kind,
                    noteText: noteText,
                    audio: audio,
                    facial: facial,
                    gemmaGroundingAction: inference.groundingAction,
                    gemmaModelResponse: inference.modelResponse,
                    gemmaSuccess: true,
                    gemmaTotalTimeMs: inference.totalTimeMs,
                    gemmaRawJSON: inference.rawResponseJSON,
                    context: context
                )
                biometricsSent = true
                setSystemStatus("Incident \(result.incidentId.suffix(6)) sent to doctor.", progress: 1.0)
                print("[Journal][Convex] ingestJournal -> incidentId=\(result.incidentId) severity=\(result.severity)")
            } catch {
                print("[Journal][Convex] ingestJournal failed: \(error.localizedDescription)")
                // Best-effort fallback through FastAPI bridge if it's running.
                let snapshot = makeTelemetrySnapshot()
                do {
                    try await env.api.uploadIncident(
                        patientId: env.patientId,
                        text: noteText,
                        facialData: [
                            "facial_stress_score": facial.facialStressScore,
                            "brow_furrow_score": facial.browFurrowScore,
                            "jaw_tightness_score": facial.jawTightnessScore,
                        ],
                        gemmaAction: inference.groundingAction,
                        audioMetrics: audio,
                        journalKind: kind,
                        gemmaSuccess: true,
                        gemmaLatencyMs: inference.totalTimeMs,
                        gemmaRawResponseJSON: inference.rawResponseJSON,
                        telemetrySnapshot: snapshot,
                        extraContext: context
                    )
                    biometricsSent = true
                    setSystemStatus("Biometrics sent via backend bridge.", progress: 1.0)
                } catch let bridgeError {
                    print("[Journal][Bridge] FastAPI fallback failed: \(bridgeError.localizedDescription)")
                    setSystemStatus("Gemma 4 succeeded. Biometrics send failed.", progress: 1.0)
                }
            }

            let session = JournalSession(
                id: UUID(),
                createdAt: Date(),
                noteText: noteText,
                videoFileName: fileName,
                kind: kind,
                audioMetrics: audio,
                facialStressScore: facial.facialStressScore,
                browFurrowScore: facial.browFurrowScore,
                jawTightnessScore: facial.jawTightnessScore,
                gemmaAction: inference.groundingAction,
                gemmaResponse: "",
                gemmaSuccess: true,
                gemmaLatencyMs: inference.totalTimeMs,
                biometricsSent: biometricsSent,
                journalSharedWithClinician: false
            )
            store.add(session)

            if biometricsSent {
                infoText = kind == .voice
                    ? "Voice journal saved. Biometrics sent. Awaiting your sharing decision."
                    : "Gemma 4 status: SUCCESS. Biometrics sent. Awaiting your sharing decision."
                pendingShareSessionID = session.id
                pendingShareFileURL = recordedURL
                pendingShareKind = kind
                showSharePrompt = true
            } else {
                infoText = kind == .voice
                    ? "Voice journal saved locally. Could not send biometrics right now."
                    : "Gemma 4 status: SUCCESS. Saved locally. Could not send biometrics right now."
            }
        } catch {
            setSystemStatus("Gemma 4 failed to process this entry.", progress: 1.0)
            errorText = "Could not analyze/save session: \(error.localizedDescription)"
            infoText = kind == .voice ? nil : "Gemma 4 status: FAILED."
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 900_000_000)
            if !isAnalyzing && !isSharingJournal {
                showStatusProgress = false
            }
        }
    }

    @MainActor
    private func setSystemStatus(_ title: String, progress: Double) {
        guard selectedKind == .video else { return }
        statusTitle = title
        statusProgress = max(0, min(1, progress))
        showStatusProgress = true
    }

    @MainActor
    private func sendPendingJournalToClinician() async {
        guard let fileURL = pendingShareFileURL, let sessionID = pendingShareSessionID else {
            dismiss()
            return
        }
        isSharingJournal = true
        setSystemStatus("Sending journal to clinician...", progress: 0.55)
        defer {
            isSharingJournal = false
            if !isAnalyzing {
                showStatusProgress = false
            }
        }

        do {
            try await env.api.uploadJournalMedia(
                fileURL: fileURL,
                patientId: env.patientId,
                journalKind: pendingShareKind,
                noteText: noteText
            )
            store.markJournalShared(sessionID)
            setSystemStatus("Journal sent to clinician.", progress: 1.0)
            infoText = "Journal sent to clinician."
        } catch {
            setSystemStatus("Journal upload failed.", progress: 1.0)
            errorText = "Biometrics were sent, but journal upload failed: \(error.localizedDescription)"
        }
        dismiss()
    }

    private func sessionIdentifierString(kind: JournalEntryKind) -> String {
        "\(kind.rawValue)-\(Int(Date().timeIntervalSince1970))"
    }

    private func makeTelemetrySnapshot() -> TelemetryBatchPayload? {
        let face = env.telemetry.latestFaceSample.map { [$0] } ?? []
        let motion = env.telemetry.latestMotionSample.map { [$0] } ?? []
        let vocal = env.telemetry.latestVocalSample.map { [$0] } ?? []
        let touch = env.telemetry.latestTouchSample.map { [$0] } ?? []
        let environment = env.telemetry.latestEnvironmentSample.map { [$0] } ?? []
        if face.isEmpty && motion.isEmpty && vocal.isEmpty && touch.isEmpty && environment.isEmpty {
            return nil
        }
        return TelemetryBatchPayload(
            emittedAtISO8601: ISO8601DateFormatter().string(from: Date()),
            faces: face,
            motions: motion,
            vocals: vocal,
            touches: touch,
            environments: environment
        )
    }

}
