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
    @Published private(set) var lastIntervention: InterventionRunResult?
    @Published private(set) var liveTranscript: String = ""
    @Published private(set) var lastRAMFootprintMB: Double = MemoryFootprint.currentMegabytes()
    @Published private(set) var lastLatencyMs: Double = 0
    @Published private(set) var clinicianProfile: ClinicianProfile = .default

    /// Weights directory names match `cactus download` output (`weights/<model-folder>`).
    private let gemma4WeightsFolder = "gemma-4-e2b-it"
    private let parakeetWeightsFolder = "parakeet-tdt-0.6b-v3"

    /// `cactus_model_t` (`void *`) from `cactus_ffi.h`.
    private var gemmaModel: UnsafeMutableRawPointer?
    private var parakeetModel: UnsafeMutableRawPointer?

    private let interventionQueue = DispatchQueue(label: "com.ember.cactus.intervention", qos: .userInitiated)
    private let listenQueue = DispatchQueue(label: "com.ember.cactus.listen", qos: .utility)

    private var memoryPoll: AnyCancellable?

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
        Self.enforceZeroCloudInferencePolicy()

        let fm = FileManager.default
        let base = try Self.applicationSupportDirectory()
        let weightsRoot = base.appendingPathComponent("weights", isDirectory: true)
        try fm.createDirectory(at: weightsRoot, withIntermediateDirectories: true)

        try Self.copyBundledWeightsIfPresent(
            named: gemma4WeightsFolder,
            to: weightsRoot.appendingPathComponent(gemma4WeightsFolder, isDirectory: true)
        )
        try Self.copyBundledWeightsIfPresent(
            named: parakeetWeightsFolder,
            to: weightsRoot.appendingPathComponent(parakeetWeightsFolder, isDirectory: true)
        )

        let gemmaPath = weightsRoot.appendingPathComponent(gemma4WeightsFolder).path
        let parakeetPath = weightsRoot.appendingPathComponent(parakeetWeightsFolder).path

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

    // MARK: - Intervention (Gemma 4)

    /// Runs a single on-device completion using `gemma-4-E2B-it` weights and parses `log_crisis_event` if present.
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

        let raw = String(cString: responseBuffer)
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
