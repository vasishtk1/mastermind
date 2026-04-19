import Foundation

enum JournalEntryKind: String, Codable, CaseIterable, Sendable {
    case video
    case voice
}

struct JournalSession: Codable, Identifiable, Sendable {
    var id: UUID
    var createdAt: Date
    var noteText: String
    var videoFileName: String
    var kind: JournalEntryKind
    var audioMetrics: AudioMetrics
    var facialStressScore: Double
    var browFurrowScore: Double
    var jawTightnessScore: Double
    var gemmaAction: String
    var gemmaResponse: String
    var gemmaSuccess: Bool?
    var gemmaLatencyMs: Double
    var biometricsSent: Bool
    var journalSharedWithClinician: Bool

    init(
        id: UUID,
        createdAt: Date,
        noteText: String,
        videoFileName: String,
        kind: JournalEntryKind,
        audioMetrics: AudioMetrics,
        facialStressScore: Double,
        browFurrowScore: Double,
        jawTightnessScore: Double,
        gemmaAction: String,
        gemmaResponse: String,
        gemmaSuccess: Bool?,
        gemmaLatencyMs: Double,
        biometricsSent: Bool,
        journalSharedWithClinician: Bool
    ) {
        self.id = id
        self.createdAt = createdAt
        self.noteText = noteText
        self.videoFileName = videoFileName
        self.kind = kind
        self.audioMetrics = audioMetrics
        self.facialStressScore = facialStressScore
        self.browFurrowScore = browFurrowScore
        self.jawTightnessScore = jawTightnessScore
        self.gemmaAction = gemmaAction
        self.gemmaResponse = gemmaResponse
        self.gemmaSuccess = gemmaSuccess
        self.gemmaLatencyMs = gemmaLatencyMs
        self.biometricsSent = biometricsSent
        self.journalSharedWithClinician = journalSharedWithClinician
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case createdAt
        case noteText
        case videoFileName
        case kind
        case audioMetrics
        case facialStressScore
        case browFurrowScore
        case jawTightnessScore
        case gemmaAction
        case gemmaResponse
        case gemmaSuccess
        case gemmaLatencyMs
        case biometricsSent
        case journalSharedWithClinician
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        noteText = try c.decode(String.self, forKey: .noteText)
        videoFileName = try c.decode(String.self, forKey: .videoFileName)
        kind = try c.decodeIfPresent(JournalEntryKind.self, forKey: .kind) ?? .video
        audioMetrics = try c.decode(AudioMetrics.self, forKey: .audioMetrics)
        facialStressScore = try c.decode(Double.self, forKey: .facialStressScore)
        browFurrowScore = try c.decode(Double.self, forKey: .browFurrowScore)
        jawTightnessScore = try c.decode(Double.self, forKey: .jawTightnessScore)
        gemmaAction = try c.decode(String.self, forKey: .gemmaAction)
        gemmaResponse = try c.decodeIfPresent(String.self, forKey: .gemmaResponse) ?? gemmaAction
        gemmaSuccess = try c.decodeIfPresent(Bool.self, forKey: .gemmaSuccess)
        gemmaLatencyMs = try c.decode(Double.self, forKey: .gemmaLatencyMs)
        biometricsSent = try c.decodeIfPresent(Bool.self, forKey: .biometricsSent) ?? false
        journalSharedWithClinician = try c.decodeIfPresent(Bool.self, forKey: .journalSharedWithClinician) ?? false
    }
}
