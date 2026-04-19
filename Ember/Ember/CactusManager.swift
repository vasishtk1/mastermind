import Foundation
import Combine

/// Owns Cactus native model handles, enforces **zero cloud fallback** for HIPAA-sensitive on-device operation,
/// and runs the Gemma 4 intervention loop via `cactus_complete`.
@MainActor
final class CactusManager: ObservableObject {
    static let shared = CactusManager()

    // MARK: - Published UI state

    @Published private(set) var mode: EmberListeningMode = .listeningParakeet
    @Published var lastError: String?
    /// Non-fatal notice when optional models (e.g. Parakeet) are not bundled.
    @Published private(set) var bootstrapNotice: String?
    @Published private(set) var lastIntervention: InterventionRunResult?
    /// Short copy of the last metrics payload shown in UI.
    @Published private(set) var lastGemmaEngineJSONPreview: String = ""
    /// Parsed `success` field from the last Gemma engine JSON, when decodable.
    @Published private(set) var lastGemmaEngineSuccess: Bool?
    @Published private(set) var liveTranscript: String = ""
    @Published private(set) var lastRAMFootprintMB: Double = MemoryFootprint.currentMegabytes()
    @Published private(set) var lastLatencyMs: Double = 0
    @Published private(set) var clinicianProfile: ClinicianProfile = .default
    @Published private(set) var realtimeMonitoringEnabled = false
    @Published private(set) var realtimeSpeechDetected = false
    @Published private(set) var realtimeVADScore: Double = 0
    @Published private(set) var realtimeChunksSeen = 0
    @Published private(set) var realtimeEventsUploaded = 0
    @Published private(set) var realtimeLastTranscript = ""
    @Published private(set) var realtimeLastGemmaSummary = ""
    @Published private(set) var realtimeLastUploadError: String?
    @Published private(set) var manualMetricsJSON: String = ""
    @Published private(set) var realtimeMetricsJSON: String = ""
    @Published private(set) var manualMetricsSequence: Int = 0
    @Published private(set) var realtimeMetricsSequence: Int = 0

    /// Weights directory names match `cactus download` output (`weights/<model-folder>`).
    private let gemma4WeightsFolder = "functiongemma-270m-it"
    private let parakeetWeightsFolder = "parakeet-tdt-0.6b-v3"

    /// `cactus_model_t` (`void *`) from `cactus_ffi.h`.
    private var gemmaModel: UnsafeMutableRawPointer?
    private var parakeetModel: UnsafeMutableRawPointer?

    private let interventionQueue = DispatchQueue(label: "com.ember.cactus.intervention", qos: .userInitiated)
    private let listenQueue = DispatchQueue(label: "com.ember.cactus.listen", qos: .utility)
    private let realtimeStream = RealtimeAudioStreamService()

    private var memoryPoll: AnyCancellable?
    private var realtimeTask: Task<Void, Never>?
    private var realtimeChunkInFlight = false
    private var internalRealtimeSeq = 0
    private var internalManualSeq = 0

    private init() {
        Self.enforceZeroCloudInferencePolicy()
        memoryPoll = Timer.publish(every: 1.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.lastRAMFootprintMB = MemoryFootprint.currentMegabytes()
            }
    }

    /// Releases native handles (call from `scenePhase` `.background` / `.inactive` in production).
    func shutdown() {
        stopRealtimeMonitoring()
        memoryPoll?.cancel()
        memoryPoll = nil
        if let gemmaModel {
            cactus_destroy(gemmaModel)
            self.gemmaModel = nil
        }
        if let parakeetModel {
            cactus_destroy(parakeetModel)
            self.parakeetModel = nil
        }
    }

    // MARK: - Clinician profile (local)

    func applyClinicianProfile(_ profile: ClinicianProfile) {
        clinicianProfile = profile
    }

    // MARK: - Setup

    /// Copies bundled weight folders from `Bundle.main` into `Application Support/Ember/weights` and initializes models.
    func bootstrapIfNeeded(patientId: String) throws {
        lastError = nil
        bootstrapNotice = nil
        Self.enforceZeroCloudInferencePolicy()

        let fm = FileManager.default
        let base = try Self.applicationSupportDirectory()
        let weightsRoot = base.appendingPathComponent("weights", isDirectory: true)
        try fm.createDirectory(at: weightsRoot, withIntermediateDirectories: true)

        try Self.copyBundledWeightsIfPresent(
            named: gemma4WeightsFolder,
            to: weightsRoot.appendingPathComponent(gemma4WeightsFolder, isDirectory: true)
        )

        let gemmaPath = weightsRoot.appendingPathComponent(gemma4WeightsFolder).path

        if gemmaModel == nil {
            var handle: UnsafeMutableRawPointer?
            gemmaPath.withCString { cPath in
                handle = cactus_init(cPath, nil, true)
            }
            guard let h = handle else {
                let err = Self.lastCactusErrorMessage()
                throw NSError(domain: "Ember", code: 1, userInfo: [NSLocalizedDescriptionKey: err])
            }
            gemmaModel = h
        }

        let hasParakeetBundle = Self.bundledWeightsFolderExists(named: parakeetWeightsFolder)
        if hasParakeetBundle {
            try Self.copyBundledWeightsIfPresent(
                named: parakeetWeightsFolder,
                to: weightsRoot.appendingPathComponent(parakeetWeightsFolder, isDirectory: true)
            )
            let parakeetPath = weightsRoot.appendingPathComponent(parakeetWeightsFolder).path
            if parakeetModel == nil {
                var handle: UnsafeMutableRawPointer?
                parakeetPath.withCString { cPath in
                    handle = cactus_init(cPath, nil, true)
                }
                guard let h = handle else {
                    let err = Self.lastCactusErrorMessage()
                    throw NSError(domain: "Ember", code: 2, userInfo: [NSLocalizedDescriptionKey: err])
                }
                parakeetModel = h
            }
        } else {
            bootstrapNotice = "Parakeet weights not bundled — on-device STT is disabled. Add `weights/parakeet-tdt-0.6b-v3` (run `cactus download nvidia/parakeet-tdt-0.6b-v3`) and rebuild."
        }

        _ = patientId // reserved for future per-patient local caches
    }

    // MARK: - Listening (Parakeet) — stub hook for continuous monitoring

    /// Placeholder for continuous STT: in production this would stream PCM into `cactus_stream_transcribe_*` or chunk `cactus_transcribe`.
    func noteListeningHeartbeat() {
        listenQueue.async { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                if self.mode == .listeningParakeet {
                    self.lastRAMFootprintMB = MemoryFootprint.currentMegabytes()
                }
            }
        }
    }

    // MARK: - Realtime monitoring (VAD -> STT -> Gemma -> DB)

    func startRealtimeMonitoring(api: APIService, patientIdProvider: @escaping () -> String) async throws {
        if realtimeMonitoringEnabled { return }
        guard gemmaModel != nil else {
            throw NSError(domain: "Ember", code: 70, userInfo: [NSLocalizedDescriptionKey: "Gemma model not initialized"])
        }

        let micOK = await realtimeStream.requestPermission()
        guard micOK else {
            throw NSError(domain: "Ember", code: 71, userInfo: [NSLocalizedDescriptionKey: "Microphone permission denied"])
        }

        let stream = try realtimeStream.startStreaming(chunkSeconds: 1.0)
        realtimeMonitoringEnabled = true
        realtimeSpeechDetected = false
        realtimeVADScore = 0
        realtimeChunksSeen = 0
        realtimeMetricsSequence = 0
        internalRealtimeSeq = 0
        realtimeLastUploadError = nil
        realtimeChunkInFlight = false
        mode = .listeningParakeet

        realtimeTask?.cancel()
        realtimeTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await chunk in stream {
                    if Task.isCancelled { break }
                    await self.processRealtimeChunk(chunk, api: api, patientId: patientIdProvider())
                }
            } catch {
                await MainActor.run {
                    self.lastError = "Realtime monitor failed: \(error.localizedDescription)"
                }
            }
            await MainActor.run {
                self.realtimeMonitoringEnabled = false
                if self.mode == .interveningGemma4 {
                    self.mode = .listeningParakeet
                }
            }
        }
    }

    func stopRealtimeMonitoring() {
        realtimeTask?.cancel()
        realtimeTask = nil
        realtimeStream.stopStreaming()
        realtimeMonitoringEnabled = false
        realtimeChunkInFlight = false
    }

    private func processRealtimeChunk(_ chunk: Data, api: APIService, patientId: String) async {
        guard realtimeMonitoringEnabled else { return }

        realtimeChunksSeen += 1
        internalRealtimeSeq += 1
        realtimeMetricsSequence = internalRealtimeSeq
        let realtimeMetrics = AudioFeatureExtractor.compute(fromPCM16LE: chunk)
        let realtimeJSON = Self.encodeMetricsEnvelopeJSON(
            source: "realtime_monitor",
            sequenceID: internalRealtimeSeq,
            metrics: realtimeMetrics,
            gemmaSuccess: nil,
            gemmaLatencyMs: nil,
            ramUsageMB: nil
        )
        realtimeMetricsJSON = realtimeJSON
        print("[Ember][Metrics][Realtime]\n\(realtimeJSON)")
        NSLog("[Ember][Metrics][Realtime] %@", realtimeJSON)

        if realtimeChunkInFlight { return }
        realtimeChunkInFlight = true
        defer { realtimeChunkInFlight = false }

        do {
            let vad = try await detectSpeechWithVAD(audioPCM: chunk)
            realtimeSpeechDetected = vad.detected
            realtimeVADScore = vad.score

            guard vad.detected else { return }

            let transcript = try await transcribePCMChunk(audioPCM: chunk)
            realtimeLastTranscript = transcript

            let gemma = try await runGemmaAudioProbe(audioPCM: chunk, updateMode: false)
            realtimeLastGemmaSummary = gemma

            let nowISO = ISO8601DateFormatter().string(from: Date())
            let event = IncomingDeviceEvent(
                patientId: patientId,
                triggerReason: "realtime_vad_speech_detected",
                distressLevel: vad.score >= 0.85 ? 7 : 4,
                interventionUsed: "cactus_vad_realtime_monitor",
                patientStabilized: false,
                deviceTimestamp: nowISO,
                interventionTranscript: "metrics=\(realtimeJSON)\n\nstt=\(transcript)\n\ngemma=\(gemma)",
                cloudInferenceUsed: false
            )
            try await api.uploadEvent(event: event)
            realtimeEventsUploaded += 1
            realtimeLastUploadError = nil
        } catch {
            realtimeLastUploadError = error.localizedDescription
        }
    }

    // MARK: - Intervention (Gemma 4)

    /// Runs a single on-device completion using FunctionGemma weights and parses `log_crisis_event` if present.
    func runInterventionAgent(triggerReason: String, patientId: String) async throws -> InterventionRunResult {
        Self.enforceZeroCloudInferencePolicy()
        guard let model = gemmaModel else {
            throw NSError(domain: "Ember", code: 3, userInfo: [NSLocalizedDescriptionKey: "Gemma model not initialized"])
        }

        mode = .interveningGemma4
        liveTranscript = ""
        defer { mode = .listeningParakeet }

        let systemPrompt = Self.buildSystemPrompt(
            base: Self.defaultClinicalSystemPrompt,
            clinicianAddendum: clinicianProfile.customSystemPrompt,
            grounding: clinicianProfile.requiredGroundingTechnique,
            pitchThreshold: clinicianProfile.pitchVarianceThreshold
        )

        let userPrompt = """
        The user may be in distress. Trigger context from on-device heuristics: \(triggerReason)

        Speak calmly, validate feelings, and guide grounding. When you believe the user is sufficiently calm and stable, \
        you MUST call the tool `log_crisis_event` exactly once with accurate fields.
        """

        let messagesJSON = try Self.encodeJSON([
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt],
        ])

        let toolsJSON = Self.logCrisisEventToolSchema

        let optionsJSON = """
        {
          "auto_handoff": false,
          "telemetry_enabled": false,
          "max_tokens": 512,
          "temperature": 0.35,
          "top_p": 0.9
        }
        """

        let bufferSize = 1024 * 1024
        let responseBuffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        responseBuffer.initialize(repeating: 0, count: bufferSize)
        defer { responseBuffer.deallocate() }

        final class TranscriptSink: @unchecked Sendable {
            private let lock = NSLock()
            private var storage = ""

            func append(_ piece: String) {
                lock.lock()
                defer { lock.unlock() }
                storage.append(piece)
            }

            var text: String {
                lock.lock()
                defer { lock.unlock() }
                return storage
            }
        }
        let sink = TranscriptSink()
        let retainedSink = Unmanaged.passRetained(sink)

        let modelPtr = model
        let rc: Int32 = await withCheckedContinuation { continuation in
            interventionQueue.async {
                defer { retainedSink.release() }

                let cb: @convention(c) (UnsafePointer<CChar>?, UInt32, UnsafeMutableRawPointer?) -> Void = { token, _, userData in
                    guard let userData else { return }
                    let sink = Unmanaged<TranscriptSink>.fromOpaque(userData).takeUnretainedValue()
                    if let token, let piece = String(validatingUTF8: token) {
                        sink.append(piece)
                    }
                }

                let userData = retainedSink.toOpaque()
                let written: Int32 = messagesJSON.withCString { m -> Int32 in
                    optionsJSON.withCString { o -> Int32 in
                        toolsJSON.withCString { t -> Int32 in
                            cactus_complete(
                                modelPtr,
                                m,
                                responseBuffer,
                                bufferSize,
                                o,
                                t,
                                cb,
                                userData,
                                nil,
                                0
                            )
                        }
                    }
                }
                continuation.resume(returning: written)
            }
        }

        if rc < 0 {
            let err = Self.lastCactusErrorMessage()
            throw NSError(domain: "Ember", code: 4, userInfo: [NSLocalizedDescriptionKey: err])
        }

        let raw = Self.decodeResponseBuffer(responseBuffer, writtenCount: rc, capacity: bufferSize)
        let parsed = try Self.parseInterventionResponse(
            rawJSON: raw,
            sinkTranscript: sink.text,
            triggerReason: triggerReason,
            patientId: patientId
        )

        lastIntervention = parsed
        lastLatencyMs = parsed.totalTimeMs
        lastRAMFootprintMB = parsed.ramUsageMB
        liveTranscript = parsed.transcript

        return parsed
    }

    /// Escalation protocol path: combines typed self-report with 5s facial stress aggregate and asks Gemma
    /// for one immediate grounding activity plus concise de-escalation guidance.
    func runInterventionAgent(
        textInput: String,
        facialStressScore: Double,
        patientId: String
    ) async throws -> ActiveAssessmentInferenceResult {
        Self.enforceZeroCloudInferencePolicy()
        guard let model = gemmaModel else {
            throw NSError(domain: "Ember", code: 3, userInfo: [NSLocalizedDescriptionKey: "Gemma model not initialized"])
        }

        mode = .interveningGemma4
        defer { mode = .listeningParakeet }

        let stressBand: String = {
            switch facialStressScore {
            case ..<0.25: return "low"
            case ..<0.55: return "moderate"
            case ..<0.8: return "high"
            default: return "very_high"
            }
        }()

        let systemPrompt = """
        You are Ember, an on-device de-escalation assistant.
        Use both the user's typed report and observed facial stress to recommend one immediate grounding activity.
        Output format:
        1) First line starts with `GROUNDING_ACTIVITY:` followed by a short activity label.
        2) Then 2-4 short supportive sentences.
        Be calm, practical, and avoid diagnosis.
        """

        let userPrompt = """
        Patient ID: \(patientId)
        Typed self-report: \(textInput)
        Facial stress score (0 to 1): \(String(format: "%.3f", facialStressScore))
        Facial stress band: \(stressBand)

        Choose a grounding activity tailored to this context and explain how to start immediately.
        """

        let messagesJSON = try Self.encodeJSON([
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt],
        ])

        let optionsJSON = """
        {
          "auto_handoff": false,
          "telemetry_enabled": false,
          "max_tokens": 300,
          "temperature": 0.25,
          "top_p": 0.9
        }
        """

        let bufferSize = 1024 * 1024
        let responseBuffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        responseBuffer.initialize(repeating: 0, count: bufferSize)
        defer { responseBuffer.deallocate() }

        let rc: Int32 = await withCheckedContinuation { continuation in
            interventionQueue.async {
                let written: Int32 = messagesJSON.withCString { m in
                    optionsJSON.withCString { o in
                        cactus_complete(
                            model,
                            m,
                            responseBuffer,
                            bufferSize,
                            o,
                            "[]",
                            nil,
                            nil,
                            nil,
                            0
                        )
                    }
                }
                continuation.resume(returning: written)
            }
        }
        if rc < 0 {
            let err = Self.lastCactusErrorMessage()
            throw NSError(domain: "Ember", code: 4, userInfo: [NSLocalizedDescriptionKey: err])
        }

        let raw = Self.decodeResponseBuffer(responseBuffer, writtenCount: rc, capacity: bufferSize)
        let response = Self.extractResponseText(fromRawJSON: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        let grounding = Self.extractGroundingAction(from: response)
        let totalMs = Self.extractGemmaTelemetry(fromRawJSON: raw).totalTimeMs ?? 0
        lastLatencyMs = totalMs

        return ActiveAssessmentInferenceResult(
            groundingAction: grounding,
            modelResponse: response,
            totalTimeMs: totalMs
        )
    }

    // MARK: - Audio probe (FunctionGemma + PCM)

    /// Runs a short completion with microphone PCM attached; logs the **full** engine JSON to stdout and the system log.
    func runGemmaAudioProbeAndLog(audioPCM: Data) async throws {
        _ = try await runGemmaAudioProbe(audioPCM: audioPCM, updateMode: true)
    }

    private func runGemmaAudioProbe(audioPCM: Data, updateMode: Bool) async throws -> String {
        await MainActor.run {
            lastGemmaEngineJSONPreview = ""
            lastGemmaEngineSuccess = nil
        }
        Self.enforceZeroCloudInferencePolicy()
        guard let model = gemmaModel else {
            throw NSError(domain: "Ember", code: 3, userInfo: [NSLocalizedDescriptionKey: "Gemma model not initialized"])
        }
        guard !audioPCM.isEmpty else {
            throw NSError(domain: "Ember", code: 60, userInfo: [NSLocalizedDescriptionKey: "Empty audio buffer"])
        }

        let messagesJSON = try Self.encodeJSON([
            ["role": "system", "content": "You are a concise assistant running entirely on-device."],
            [
                "role": "user",
                "content": "Listen to this microphone capture. Summarize what you hear in 2–3 short sentences. If audio is silent or unclear, say so.",
            ],
        ])

        let optionsJSON = """
        {
          "auto_handoff": false,
          "telemetry_enabled": false,
          "max_tokens": 400,
          "temperature": 0.35,
          "top_p": 0.9
        }
        """

        let toolsJSON = "[]"

        if updateMode {
            await MainActor.run { mode = .interveningGemma4 }
        }

        let bufferSize = 1024 * 1024
        let responseBuffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        responseBuffer.initialize(repeating: 0, count: bufferSize)
        defer { responseBuffer.deallocate() }

        let modelPtr = model
        let pcmCount = audioPCM.count

        let rc: Int32 = await withCheckedContinuation { continuation in
            interventionQueue.async {
                let written: Int32 = audioPCM.withUnsafeBytes { rawBuf -> Int32 in
                    guard let base = rawBuf.bindMemory(to: UInt8.self).baseAddress else {
                        return Int32(-1)
                    }
                    return messagesJSON.withCString { m in
                        optionsJSON.withCString { o in
                            toolsJSON.withCString { t in
                                cactus_complete(
                                    modelPtr,
                                    m,
                                    responseBuffer,
                                    bufferSize,
                                    o,
                                    t,
                                    nil,
                                    nil,
                                    base,
                                    pcmCount
                                )
                            }
                        }
                    }
                }
                continuation.resume(returning: written)
            }
        }

        if rc < 0 {
            let err = Self.lastCactusErrorMessage()
            if updateMode {
                await MainActor.run { mode = .listeningParakeet }
            }
            throw NSError(domain: "Ember", code: 4, userInfo: [NSLocalizedDescriptionKey: err])
        }

        let raw = Self.decodeResponseBuffer(responseBuffer, writtenCount: rc, capacity: bufferSize)
        let responseText = Self.extractResponseText(fromRawJSON: raw)
        let metrics = AudioFeatureExtractor.compute(fromPCM16LE: audioPCM)
        let gemmaParsed = Self.extractGemmaTelemetry(fromRawJSON: raw)
        if updateMode {
            internalManualSeq += 1
            manualMetricsSequence = internalManualSeq
        }
        let seq = updateMode ? internalManualSeq : internalRealtimeSeq
        let metricsJSON = Self.encodeMetricsEnvelopeJSON(
            source: updateMode ? "manual_recording" : "realtime_voiced_chunk",
            sequenceID: seq,
            metrics: metrics,
            gemmaSuccess: gemmaParsed.success,
            gemmaLatencyMs: gemmaParsed.totalTimeMs,
            ramUsageMB: gemmaParsed.ramUsageMB
        )

        await MainActor.run {
            print("[Ember][Metrics]\n\(metricsJSON)")
            NSLog("[Ember][Metrics] %@", metricsJSON)

            let previewLimit = 4_096
            let preview = metricsJSON.count <= previewLimit
                ? metricsJSON
                : String(metricsJSON.prefix(previewLimit)) + "\n… (truncated for on-screen preview)"
            lastGemmaEngineJSONPreview = preview
            manualMetricsJSON = preview

            lastGemmaEngineSuccess = gemmaParsed.success
            if let totalMs = gemmaParsed.totalTimeMs { lastLatencyMs = totalMs }
            if let ramMb = gemmaParsed.ramUsageMB { lastRAMFootprintMB = ramMb }

            if updateMode {
                mode = .listeningParakeet
            }
        }

        return responseText
    }

    private func detectSpeechWithVAD(audioPCM: Data) async throws -> (detected: Bool, score: Double) {
        guard let model = parakeetModel else {
            // FunctionGemma weights are not guaranteed to expose VAD kernels; fall back to RMS detector.
            let fallbackScore = Self.rmsEnergyScore(fromPCM16LE: audioPCM)
            return (fallbackScore > 0.012, fallbackScore)
        }
        let optionsJSON = #"{"sample_rate":16000}"#
        let bufferSize = 256 * 1024
        let responseBuffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        responseBuffer.initialize(repeating: 0, count: bufferSize)
        defer { responseBuffer.deallocate() }

        let rc: Int32 = await withCheckedContinuation { continuation in
            listenQueue.async {
                let written: Int32 = audioPCM.withUnsafeBytes { rawBuf in
                    guard let base = rawBuf.bindMemory(to: UInt8.self).baseAddress else { return Int32(-1) }
                    return optionsJSON.withCString { opt in
                        cactus_vad(
                            model,
                            nil,
                            responseBuffer,
                            bufferSize,
                            opt,
                            base,
                            audioPCM.count
                        )
                    }
                }
                continuation.resume(returning: written)
            }
        }

        if rc < 0 {
            let err = Self.lastCactusErrorMessage()
            throw NSError(domain: "Ember", code: 73, userInfo: [NSLocalizedDescriptionKey: "VAD failed: \(err)"])
        }

        let raw = Self.decodeResponseBuffer(responseBuffer, writtenCount: rc, capacity: bufferSize)
        if let data = raw.data(using: .utf8),
           let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let score = Self.numberValue(root, keys: ["speech_probability", "score", "confidence"]) ?? 0
            let detected = Self.boolValue(root, keys: ["speech_detected", "contains_speech", "has_speech", "is_speech"]) ?? (score >= 0.5)
            return (detected, score)
        }

        let fallbackScore = Self.rmsEnergyScore(fromPCM16LE: audioPCM)
        return (fallbackScore > 0.012, fallbackScore)
    }

    private func transcribePCMChunk(audioPCM: Data) async throws -> String {
        guard let model = parakeetModel else {
            throw NSError(
                domain: "Ember",
                code: 74,
                userInfo: [NSLocalizedDescriptionKey: "Parakeet model not initialized. Bundle `parakeet-tdt-0.6b-v3` for realtime STT."]
            )
        }
        let optionsJSON = #"{"task":"transcribe","sample_rate":16000}"#
        let bufferSize = 1024 * 1024
        let responseBuffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        responseBuffer.initialize(repeating: 0, count: bufferSize)
        defer { responseBuffer.deallocate() }

        let rc: Int32 = await withCheckedContinuation { continuation in
            listenQueue.async {
                let written: Int32 = audioPCM.withUnsafeBytes { rawBuf in
                    guard let base = rawBuf.bindMemory(to: UInt8.self).baseAddress else { return Int32(-1) }
                    return optionsJSON.withCString { opt in
                        cactus_transcribe(
                            model,
                            nil,
                            nil,
                            responseBuffer,
                            bufferSize,
                            opt,
                            nil,
                            nil,
                            base,
                            audioPCM.count
                        )
                    }
                }
                continuation.resume(returning: written)
            }
        }
        if rc < 0 {
            let err = Self.lastCactusErrorMessage()
            throw NSError(domain: "Ember", code: 75, userInfo: [NSLocalizedDescriptionKey: "Transcription failed: \(err)"])
        }

        let raw = Self.decodeResponseBuffer(responseBuffer, writtenCount: rc, capacity: bufferSize)
        return Self.extractTranscriptionText(fromRawJSON: raw)
    }

    // MARK: - HIPAA: zero cloud fallback

    private static func enforceZeroCloudInferencePolicy() {
        unsetenv("CACTUS_CLOUD_KEY")
        unsetenv("CACTUS_CLOUD_API_KEY")
        unsetenv("GEMINI_API_KEY")
        unsetenv("GOOGLE_API_KEY")
        setenv("CACTUS_NO_CLOUD_TELE", "1", 1)
        cactus_log_set_level(3) // ERROR
    }

    private static func lastCactusErrorMessage() -> String {
        if let p = cactus_get_last_error(), let s = String(validatingUTF8: p) {
            return s
        }
        return "Unknown Cactus error"
    }

    // MARK: - Paths

    private static func applicationSupportDirectory() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Ember", isDirectory: true)
    }

    private static func bundledWeightsFolderExists(named folder: String) -> Bool {
        guard let srcRoot = Bundle.main.resourceURL?.appendingPathComponent("weights", isDirectory: true) else {
            return false
        }
        let src = srcRoot.appendingPathComponent(folder, isDirectory: true)
        return FileManager.default.fileExists(atPath: src.path)
    }

    private static func copyBundledWeightsIfPresent(named folder: String, to destinationDir: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: destinationDir.appendingPathComponent("config.txt").path) {
            return
        }

        guard let srcRoot = Bundle.main.resourceURL?.appendingPathComponent("weights", isDirectory: true) else {
            throw NSError(domain: "Ember", code: 10, userInfo: [NSLocalizedDescriptionKey: "Bundle resourceURL missing"])
        }
        let src = srcRoot.appendingPathComponent(folder, isDirectory: true)
        guard fm.fileExists(atPath: src.path) else {
            throw NSError(
                domain: "Ember",
                code: 11,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Missing bundled weights folder `weights/\(folder)`. Add it to the Xcode target (Copy Bundle Resources)."
                ]
            )
        }

        if fm.fileExists(atPath: destinationDir.path) {
            try fm.removeItem(at: destinationDir)
        }
        try fm.createDirectory(at: destinationDir.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.copyItem(at: src, to: destinationDir)
    }

    // MARK: - Prompting + tools

    private static let defaultClinicalSystemPrompt = """
    You are Ember, a clinical de-escalation assistant running entirely on-device.

    Rules:
    - You are NOT a licensed clinician; do not diagnose. Provide supportive, evidence-informed calming guidance.
    - No medical directives that require in-person evaluation. If the user expresses imminent self-harm or harm to others, \
      urge contacting local emergency services or a crisis line immediately.
    - Keep language simple, compassionate, and non-judgmental. Short paragraphs; ask one question at a time.
    - Prefer grounding techniques (breathing, 5-4-3-2-1 sensory grounding) when appropriate.
    - When the user appears calm enough to discontinue active intervention, call `log_crisis_event` exactly once.
    """

    private static func buildSystemPrompt(
        base: String,
        clinicianAddendum: String,
        grounding: String,
        pitchThreshold: Double
    ) -> String {
        var parts: [String] = [base.trimmingCharacters(in: .whitespacesAndNewlines)]
        parts.append("Clinician-configured grounding preference: \(grounding).")
        parts.append("Heuristic pitch-variance threshold (unitless): \(pitchThreshold).")
        if !clinicianAddendum.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append("Clinician system prompt addendum:\n\(clinicianAddendum)")
        }
        return parts.joined(separator: "\n\n")
    }

    private static let logCrisisEventToolSchema = #"""
    [
      {
        "type": "function",
        "function": {
          "name": "log_crisis_event",
          "description": "Log a structured crisis/de-escalation event when the user is calm enough to end active intervention.",
          "parameters": {
            "type": "object",
            "properties": {
              "distress_level": { "type": "integer", "minimum": 0, "maximum": 10 },
              "intervention_used": { "type": "string" },
              "patient_stabilized": { "type": "boolean" }
            },
            "required": ["distress_level", "intervention_used", "patient_stabilized"]
          }
        }
      }
    ]
    """#

    // MARK: - JSON helpers

    private static func encodeJSON(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [])
        guard let s = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "Ember", code: 20, userInfo: [NSLocalizedDescriptionKey: "UTF-8 encode failed"])
        }
        return s
    }

    private static func decodeResponseBuffer(_ buffer: UnsafeMutablePointer<CChar>, writtenCount: Int32, capacity: Int) -> String {
        let safeCapacity = max(0, capacity)
        let n = Int(max(0, writtenCount))
        if n > 0 {
            let bounded = min(n, max(0, safeCapacity - 1))
            let rawPtr = UnsafeRawPointer(buffer)
            let data = Data(bytes: rawPtr, count: bounded)
            if let s = String(data: data, encoding: .utf8), !s.isEmpty {
                return s
            }
        }
        return String(cString: buffer)
    }

    private static func extractGemmaTelemetry(fromRawJSON rawJSON: String) -> (success: Bool?, totalTimeMs: Double?, ramUsageMB: Double?) {
        guard let data = rawJSON.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return (nil, nil, nil)
        }
        let success = (root["success"] as? Bool) ?? (root["success"] as? NSNumber)?.boolValue
        let totalMs = numberValue(root, keys: ["total_time_ms"])
        let ram = numberValue(root, keys: ["ram_usage_mb"])
        return (success, totalMs, ram)
    }

    private static func encodeMetricsEnvelopeJSON(
        source: String,
        sequenceID: Int,
        metrics: AudioMetrics,
        gemmaSuccess: Bool?,
        gemmaLatencyMs: Double?,
        ramUsageMB: Double?
    ) -> String {
        var obj: [String: Any] = [
            "source": source,
            "sequence_id": sequenceID,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "metrics": [
                "sample_rate_hz": metrics.sampleRateHz,
                "duration_sec": metrics.durationSec,
                "fundamental_frequency_hz": metrics.fundamentalFrequencyHz,
                "jitter_approx": metrics.jitterApprox,
                "shimmer_approx": metrics.shimmerApprox,
                "rms": metrics.rms,
                "spectral_flux": metrics.spectralFlux,
                "mfcc_deviation": metrics.mfccDeviation,
                "mfcc_1_to_13": metrics.mfcc1to13,
                "pitch_escalation": metrics.pitchEscalation,
                "breath_rate": metrics.breathRate,
                "spectral_centroid": metrics.spectralCentroid,
                "spectral_rolloff": metrics.spectralRolloff,
                "zcr_density": metrics.zcrDensity,
            ],
        ]
        if let gemmaSuccess { obj["gemma_success"] = gemmaSuccess }
        if let gemmaLatencyMs { obj["gemma_total_time_ms"] = gemmaLatencyMs }
        if let ramUsageMB { obj["ram_usage_mb"] = ramUsageMB }

        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "{}"
    }

    private static func extractResponseText(fromRawJSON rawJSON: String) -> String {
        guard let data = rawJSON.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ""
        }
        return (root["response"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func extractGroundingAction(from response: String) -> String {
        let lines = response.components(separatedBy: .newlines)
        if let tagged = lines.first(where: { $0.uppercased().contains("GROUNDING_ACTIVITY:") }) {
            if let range = tagged.range(of: "GROUNDING_ACTIVITY:", options: .caseInsensitive) {
                let raw = tagged[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
                if !raw.isEmpty { return raw }
            }
        }
        if let first = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines), !first.isEmpty {
            return first
        }
        return "box breathing"
    }

    private static func extractTranscriptionText(fromRawJSON rawJSON: String) -> String {
        guard let data = rawJSON.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return rawJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let candidates: [String?] = [
            root["text"] as? String,
            root["transcript"] as? String,
            root["response"] as? String,
        ]
        for value in candidates {
            let cleaned = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleaned.isEmpty {
                return cleaned
            }
        }
        return rawJSON.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func rmsEnergyScore(fromPCM16LE pcm: Data) -> Double {
        guard pcm.count >= 2 else { return 0 }
        let sampleCount = pcm.count / 2
        let sumSquares: Double = pcm.withUnsafeBytes { raw in
            let s = raw.bindMemory(to: Int16.self)
            var accum: Double = 0
            for i in 0..<sampleCount {
                let normalized = Double(s[i]) / Double(Int16.max)
                accum += normalized * normalized
            }
            return accum
        }
        return sqrt(sumSquares / Double(sampleCount))
    }

    private static func numberValue(_ root: [String: Any], keys: [String]) -> Double? {
        for key in keys {
            if let n = root[key] as? Double { return n }
            if let n = root[key] as? NSNumber { return n.doubleValue }
            if let s = root[key] as? String, let n = Double(s) { return n }
        }
        return nil
    }

    private static func boolValue(_ root: [String: Any], keys: [String]) -> Bool? {
        for key in keys {
            if let b = root[key] as? Bool { return b }
            if let n = root[key] as? NSNumber { return n.boolValue }
            if let s = root[key] as? String {
                switch s.lowercased() {
                case "true", "1", "yes", "y": return true
                case "false", "0", "no", "n": return false
                default: break
                }
            }
        }
        return nil
    }

    private static func parseInterventionResponse(
        rawJSON: String,
        sinkTranscript: String,
        triggerReason: String,
        patientId: String
    ) throws -> InterventionRunResult {
        guard let data = rawJSON.data(using: .utf8) else {
            throw NSError(domain: "Ember", code: 30, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 response"])
        }

        let obj = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        guard let root = obj as? [String: Any] else {
            throw NSError(domain: "Ember", code: 31, userInfo: [NSLocalizedDescriptionKey: "Top-level JSON was not an object"])
        }

        let success = (root["success"] as? Bool) ?? false
        if !success {
            let err = (root["error"] as? String) ?? "Unknown inference error"
            throw NSError(domain: "Ember", code: 32, userInfo: [NSLocalizedDescriptionKey: err])
        }

        let responseText = (root["response"] as? String) ?? ""
        let cloudHandoff = (root["cloud_handoff"] as? Bool) ?? false
        let totalMs = (root["total_time_ms"] as? Double) ?? (root["total_time_ms"] as? NSNumber)?.doubleValue ?? 0
        let ttftMs = (root["time_to_first_token_ms"] as? Double) ?? (root["time_to_first_token_ms"] as? NSNumber)?.doubleValue ?? 0
        let ramMb = (root["ram_usage_mb"] as? Double) ?? (root["ram_usage_mb"] as? NSNumber)?.doubleValue ?? 0

        let transcript: String = {
            let t = sinkTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { return t }
            return responseText.trimmingCharacters(in: .whitespacesAndNewlines)
        }()

        let calls = root["function_calls"] as? [Any] ?? []
        let crisis = Self.extractLogCrisisEvent(fromFunctionCalls: calls, triggerReason: triggerReason, patientId: patientId, transcript: transcript)

        return InterventionRunResult(
            rawResponseJSON: rawJSON,
            assistantVisibleText: responseText,
            transcript: transcript,
            totalTimeMs: totalMs,
            timeToFirstTokenMs: ttftMs,
            ramUsageMB: ramMb,
            cloudHandoff: cloudHandoff,
            crisisEvent: crisis
        )
    }

    /// Tolerates malformed tool JSON from the model by returning nil instead of throwing.
    private static func extractLogCrisisEvent(
        fromFunctionCalls calls: [Any],
        triggerReason: String,
        patientId: String,
        transcript: String
    ) -> IncomingDeviceEvent? {
        for item in calls {
            guard let callString = item as? String, let callData = callString.data(using: .utf8) else { continue }
            guard let callObj = try? JSONSerialization.jsonObject(with: callData) as? [String: Any] else { continue }
            let name = (callObj["name"] as? String) ?? ""
            guard name == "log_crisis_event" else { continue }

            let argsAny = callObj["arguments"]
            let argsObj: [String: Any]? = {
                if let d = argsAny as? [String: Any] { return d }
                if let s = argsAny as? String, let d = s.data(using: .utf8) {
                    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
                }
                return nil
            }()

            guard let argsObj else { continue }

            let distress = (argsObj["distress_level"] as? Int) ?? (argsObj["distress_level"] as? NSNumber)?.intValue ?? 0
            let intervention = (argsObj["intervention_used"] as? String) ?? "unknown"
            let stabilized = (argsObj["patient_stabilized"] as? Bool) ?? (argsObj["patient_stabilized"] as? NSNumber)?.boolValue ?? false

            let iso = ISO8601DateFormatter().string(from: Date())
            return IncomingDeviceEvent(
                patientId: patientId,
                triggerReason: triggerReason,
                distressLevel: distress,
                interventionUsed: intervention,
                patientStabilized: stabilized,
                deviceTimestamp: iso,
                interventionTranscript: transcript,
                cloudInferenceUsed: false
            )
        }
        return nil
    }
}
