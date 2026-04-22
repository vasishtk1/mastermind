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

// MARK: - Escalation protocol

struct ActiveAssessmentInferenceResult: Sendable {
    var groundingAction: String
    var modelResponse: String
    var rawResponseJSON: String
    var totalTimeMs: Double
}

struct ClinicianDirective: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var details: String
    var createdAt: String?
    var directiveType: String?
    var instructions: String?
    var deployedAt: Date?
    var acknowledged: Bool?
    var incidentId: String?

    /// Friendly display title — falls back to the directive type when the
    /// upstream `title` is empty (Convex documents only carry `directiveType`
    /// + `instructions`).
    var displayTitle: String {
        if !title.isEmpty { return title }
        if let t = directiveType, !t.isEmpty { return t }
        return "Clinician directive"
    }

    /// Detail text shown under the title — prefers explicit `instructions`
    /// from Convex, otherwise the legacy `details` string.
    var displayInstructions: String {
        if let i = instructions, !i.isEmpty { return i }
        return details
    }
}
