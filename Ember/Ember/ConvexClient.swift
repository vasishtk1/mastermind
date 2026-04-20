import Foundation

/// Direct HTTP client for Convex. Bypasses the FastAPI backend entirely so iOS
/// journal entries land in Convex even when the local backend is down or the
/// device is on a different network than your laptop.
///
/// Convex exposes a public mutation endpoint at `POST {CONVEX_URL}/api/mutation`
/// that accepts `{ "path": "module:function", "args": {...}, "format": "json" }`.
/// Public mutations (the kind we declare in `convex/iosIngest.ts`) require no
/// auth, which is what we want for the on-device journaling pipeline.
final class ConvexClient {
    static let shared = ConvexClient()

    private let session: URLSession
    private let convexURL: URL?

    init(convexURL: URL? = Bundle.main.emberConvexURL) {
        self.convexURL = convexURL
        let config = URLSessionConfiguration.ephemeral
        // Fail fast if the laptop / cloud deployment isn't reachable so the
        // journal save UI doesn't hang on the user. The whole mutation should
        // typically complete in well under a second when the network is OK.
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)
    }

    var isConfigured: Bool { convexURL != nil }

    /// Calls a public Convex mutation by path. Returns the decoded `value`
    /// from the response or throws if the request fails.
    @discardableResult
    func runMutation(path: String, args: [String: Any]) async throws -> Any? {
        try await runConvexCall(endpoint: "api/mutation", path: path, args: args)
    }

    /// Calls a public Convex query by path. Returns the decoded `value`.
    @discardableResult
    func runQuery(path: String, args: [String: Any]) async throws -> Any? {
        try await runConvexCall(endpoint: "api/query", path: path, args: args)
    }

    private func runConvexCall(endpoint: String, path: String, args: [String: Any]) async throws -> Any? {
        guard let convexURL else {
            throw NSError(
                domain: "ConvexClient",
                code: -1,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Convex URL not configured. Add 'ConvexURL' to Info.plist (e.g. https://<deployment>.convex.cloud).",
                ]
            )
        }
        let url = convexURL.appendingPathComponent(endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "path": path,
            "args": args,
            "format": "json",
        ]
        request.httpBody = try JSONSerialization.data(
            withJSONObject: body, options: []
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            let snippet = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "ConvexClient",
                code: http.statusCode,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Convex \(endpoint) (\(path)) failed (HTTP \(http.statusCode)): \(snippet.prefix(400))",
                ]
            )
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let status = json?["status"] as? String, status != "success" {
            let errMsg = (json?["errorMessage"] as? String) ?? "Convex call failed"
            throw NSError(
                domain: "ConvexClient",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "\(errMsg)"]
            )
        }
        return json?["value"]
    }

    // MARK: - Directives

    /// Pulls the most recent clinician directives for a patient from Convex.
    /// Returns directives ordered newest-first.
    func listDirectives(patientId: String, limit: Int = 25) async throws -> [ClinicianDirective] {
        let value = try await runQuery(
            path: "directives:listByPatient",
            args: [
                "patientId": patientId,
                "limit": limit,
            ]
        )
        guard let rows = value as? [[String: Any]] else { return [] }
        return rows.compactMap { Self.decodeDirective($0) }
    }

    /// Marks a directive as acknowledged on Convex (and patches the linked
    /// IncidentReport mirror so the dashboard reflects it).
    func acknowledgeDirective(directiveId: String) async throws {
        _ = try await runMutation(
            path: "directives:acknowledge",
            args: [
                "directiveId": directiveId,
                "acknowledgedAt": Date().timeIntervalSince1970 * 1000,
            ]
        )
    }

    private static func decodeDirective(_ row: [String: Any]) -> ClinicianDirective? {
        guard let directiveId = row["directiveId"] as? String else { return nil }
        let directiveType = row["directiveType"] as? String
        let instructions = (row["instructions"] as? String) ?? ""
        let deployedMs = row["deployedAt"] as? Double
        let deployedAt = deployedMs.map { Date(timeIntervalSince1970: $0 / 1000) }
        let acknowledged = row["acknowledged"] as? Bool
        let incidentId = row["incidentId"] as? String

        let isoCreatedAt: String? = deployedAt.map {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime]
            return f.string(from: $0)
        }
        return ClinicianDirective(
            id: directiveId,
            title: directiveType ?? "Clinician directive",
            details: instructions,
            createdAt: isoCreatedAt,
            directiveType: directiveType,
            instructions: instructions,
            deployedAt: deployedAt,
            acknowledged: acknowledged,
            incidentId: incidentId
        )
    }

    /// Convenience for the iOS journal pipeline. Bundles audio + facial +
    /// Gemma into the single atomic Convex mutation `iosIngest:journal`.
    @discardableResult
    func ingestJournal(
        patientId: String,
        patientName: String?,
        journalKind: JournalEntryKind,
        noteText: String,
        audio: AudioMetrics,
        facial: JournalTelemetryAnalyzer.FacialTelemetry,
        gemmaGroundingAction: String,
        gemmaModelResponse: String,
        gemmaSuccess: Bool,
        gemmaTotalTimeMs: Double,
        gemmaRawJSON: String,
        context: [String: Any]?
    ) async throws -> ConvexIngestResult {
        let audioPayload: [String: Any] = [
            "breath_rate": audio.breathRate,
            "duration_sec": audio.durationSec,
            "fundamental_frequency_hz": audio.fundamentalFrequencyHz,
            "jitter_approx": audio.jitterApprox,
            "mfcc_1_to_13": audio.mfcc1to13,
            "mfcc_deviation": audio.mfccDeviation,
            "pitch_escalation": audio.pitchEscalation,
            "rms": audio.rms,
            "sample_rate_hz": audio.sampleRateHz,
            "shimmer_approx": audio.shimmerApprox,
            "spectral_centroid": audio.spectralCentroid,
            "spectral_flux": audio.spectralFlux,
            "spectral_rolloff": audio.spectralRolloff,
            "zcr_density": audio.zcrDensity,
        ]
        let facialPayload: [String: Any] = [
            "facial_stress_score": facial.facialStressScore,
            "brow_furrow_score": facial.browFurrowScore,
            "jaw_tightness_score": facial.jawTightnessScore,
        ]
        var gemmaPayload: [String: Any] = [
            "grounding_action": gemmaGroundingAction,
            "model_response": gemmaModelResponse,
            "success": gemmaSuccess,
            "total_time_ms": gemmaTotalTimeMs,
        ]
        if !gemmaRawJSON.isEmpty {
            // Cap to keep request body lean; full JSON is mirrored elsewhere if needed.
            gemmaPayload["raw_json"] = String(gemmaRawJSON.prefix(12_000))
        }

        var args: [String: Any] = [
            "patientId": patientId,
            "journalKind": journalKind.rawValue,
            "noteText": noteText,
            "createdAtIso": ISO8601DateFormatter().string(from: Date()),
            "audio": audioPayload,
            "facial": facialPayload,
            "gemma": gemmaPayload,
        ]
        if let patientName, !patientName.isEmpty {
            args["patientName"] = patientName
        }
        if let context {
            args["context"] = context
        }

        let value = try await runMutation(path: "iosIngest:journal", args: args)
        let dict = value as? [String: Any]
        let incidentId = dict?["incidentId"] as? String ?? ""
        let severity = dict?["severity"] as? String ?? "moderate"
        return ConvexIngestResult(incidentId: incidentId, severity: severity)
    }
}

struct ConvexIngestResult: Sendable {
    let incidentId: String
    let severity: String
}

extension Bundle {
    /// Preferred Convex deployment URL for direct iOS writes. Configure in
    /// Info.plist via `ConvexURL` (e.g. `https://<dep>.convex.cloud` for the
    /// hosted deployment, or `http://192.168.x.x:3210` for a Mac-hosted local
    /// dev convex).
    var emberConvexURL: URL? {
        if let s = object(forInfoDictionaryKey: "ConvexURL") as? String {
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, let u = URL(string: trimmed) {
                return u
            }
        }
        return nil
    }
}
