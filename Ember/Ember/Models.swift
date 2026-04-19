import Foundation

// MARK: - App state

enum EmberListeningMode: String, Sendable {
    case listeningParakeet = "Listening (Parakeet)"
    case interveningGemma4 = "Intervening (Gemma 4)"
}

// MARK: - Clinician profile (remote)

struct ClinicianProfile: Codable, Equatable, Sendable {
    var pitchVarianceThreshold: Double
    var requiredGroundingTechnique: String
    var customSystemPrompt: String

    static let `default` = ClinicianProfile(
        pitchVarianceThreshold: 0.35,
        requiredGroundingTechnique: "box_breathing",
        customSystemPrompt: ""
    )
}

// MARK: - Device → backend event

/// Payload POSTed to `/api/events` after a completed intervention when the model emits `log_crisis_event`.
struct IncomingDeviceEvent: Codable, Sendable {
    var patientId: String
    var triggerReason: String
    var distressLevel: Int
    var interventionUsed: String
    var patientStabilized: Bool
    /// ISO-8601 string for portability across stacks.
    var deviceTimestamp: String
    var interventionTranscript: String
    /// Always false for Ember builds that enforce zero cloud fallback.
    var cloudInferenceUsed: Bool
}

// MARK: - Intervention outcome (local)

struct InterventionRunResult: Sendable {
    var rawResponseJSON: String
    var assistantVisibleText: String
    var transcript: String
    var totalTimeMs: Double
    var timeToFirstTokenMs: Double
    var ramUsageMB: Double
    var cloudHandoff: Bool
    var crisisEvent: IncomingDeviceEvent?
}
