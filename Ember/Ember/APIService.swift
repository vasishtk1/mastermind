import Foundation
import UniformTypeIdentifiers

/// Native `URLSession` client for the Ember FastAPI backend.
final class APIService: ObservableObject {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let candidateBaseURLs: [URL]

    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.encoder.outputFormatting = [.sortedKeys]
        self.encoder.keyEncodingStrategy = .convertToSnakeCase

        self.decoder = JSONDecoder()
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase

        var candidates: [URL] = [baseURL]
        if let host = baseURL.host?.lowercased(),
           host == "127.0.0.1" || host == "localhost",
           let port = baseURL.port {
            if port == 8000, let alt = URL(string: "\(baseURL.scheme ?? "http")://\(host):8001") {
                candidates.append(alt)
            } else if port == 8001, let alt = URL(string: "\(baseURL.scheme ?? "http")://\(host):8000") {
                candidates.append(alt)
            }
        }
        var deduped: [URL] = []
        for candidate in candidates where !deduped.contains(candidate) {
            deduped.append(candidate)
        }
        self.candidateBaseURLs = deduped
    }

    // MARK: - Push

    func uploadEvent(event: IncomingDeviceEvent) async throws {
        let body = try encoder.encode(event)
        let (_, http) = try await performRequest(relativePath: "api/events") { url in
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
            return request
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST /api/events failed with status \(http.statusCode)"]
            )
        }
    }

    func uploadIncident(
        patientId: String,
        text: String,
        facialData: [String: Double],
        gemmaAction: String,
        audioMetrics: AudioMetrics? = nil,
        journalKind: JournalEntryKind? = nil,
        gemmaSuccess: Bool? = nil,
        gemmaLatencyMs: Double? = nil,
        gemmaRawResponseJSON: String? = nil,
        telemetrySnapshot: TelemetryBatchPayload? = nil,
        extraContext: [String: Any]? = nil
    ) async throws {
        let biometrics: [String: Any] = [
            "facial": facialData,
            "audio": audioMetrics.map(audioMetricsDictionary) ?? NSNull(),
            "telemetry_snapshot": telemetrySnapshot.flatMap(encodableAsJSONObject) ?? NSNull(),
        ]
        var model: [String: Any] = ["gemma_action": gemmaAction]
        if let gemmaSuccess { model["gemma_success"] = gemmaSuccess }
        if let gemmaLatencyMs { model["gemma_total_time_ms"] = gemmaLatencyMs }
        if let gemmaRawResponseJSON { model["gemma_raw_response_json"] = gemmaRawResponseJSON }

        let body: [String: Any] = [
            "patient_id": patientId,
            "text": text,
            "journal_kind": journalKind?.rawValue ?? NSNull(),
            "biometrics": biometrics,
            "model": model,
            "context": extraContext ?? NSNull(),
            "facial_data": facialData,
            "gemma_action": gemmaAction,
            "created_at": ISO8601DateFormatter().string(from: Date()),
        ]
        if let payload = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]),
           let payloadText = String(data: payload, encoding: .utf8) {
            print("[MasterMind][DoctorPayload][Incident]\n\(payloadText)")
            NSLog("[MasterMind][DoctorPayload][Incident] %@", payloadText)
        }
        let requestBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (_, http) = try await performRequest(relativePath: "api/incidents") { url in
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = requestBody
            return request
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "APIService", code: 500, userInfo: [NSLocalizedDescriptionKey: "POST /api/incidents failed"])
        }
    }

    func uploadJournalMedia(
        fileURL: URL,
        patientId: String,
        journalKind: JournalEntryKind,
        noteText: String
    ) async throws {
        let boundary = "Boundary-\(UUID().uuidString)"

        let mimeType: String = {
            if let type = UTType(filenameExtension: fileURL.pathExtension.lowercased()) {
                return type.preferredMIMEType ?? "application/octet-stream"
            }
            return "application/octet-stream"
        }()

        var body = Data()
        func appendText(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }

        appendText("patient_id", patientId)
        appendText("journal_kind", journalKind.rawValue)
        appendText("note_text", noteText)
        appendText("created_at", ISO8601DateFormatter().string(from: Date()))

        let fileData = try Data(contentsOf: fileURL)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"journal_file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!
        )
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        let (_, http) = try await performRequest(relativePath: "api/journals/upload") { url in
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
            return request
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: 500,
                userInfo: [NSLocalizedDescriptionKey: "POST /api/journals/upload failed"]
            )
        }
    }

    private func audioMetricsDictionary(_ metrics: AudioMetrics) -> [String: Any] {
        [
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
        ]
    }

    private func encodableAsJSONObject<T: Encodable>(_ value: T) -> [String: Any]? {
        guard let data = try? encoder.encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return obj
    }

    // MARK: - Pull

    func fetchClinicianProfile(patientId: String) async throws -> ClinicianProfile {
        let safePatientId = patientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? patientId
        let path = "api/patients/\(safePatientId)/profile"
        let (data, http) = try await performRequest(relativePath: path) { url in
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            return request
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "GET profile failed with status \(http.statusCode)"]
            )
        }
        return try decoder.decode(ClinicianProfile.self, from: data)
    }

    func fetchClinicianDirectives(patientId: String) async throws -> [ClinicianDirective] {
        let safePatientId = patientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? patientId
        let path = "api/patients/\(safePatientId)/directives"
        let (data, http) = try await performRequest(relativePath: path) { url in
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            return request
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "GET directives failed with status \(http.statusCode)"]
            )
        }
        return try decoder.decode([ClinicianDirective].self, from: data)
    }

    private func performRequest(
        relativePath: String,
        requestBuilder: (URL) -> URLRequest
    ) async throws -> (Data, HTTPURLResponse) {
        var lastError: Error?
        var attempted: [String] = []
        for base in candidateBaseURLs {
            let url = base.appendingPathComponent(relativePath)
            attempted.append(url.absoluteString)
            do {
                let (data, response) = try await session.data(for: requestBuilder(url))
                guard let http = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                return (data, http)
            } catch {
                lastError = error
                if shouldRetryOnAlternateBase(error: error) {
                    continue
                }
                throw error
            }
        }
        if let urlError = lastError as? URLError, urlError.code == .cannotConnectToHost {
            let hint: String
            if Self.isPhysicalDeviceLoopback(baseURL: baseURL) {
                hint = "Could not connect to local backend from this iPhone. Set Info.plist APIBaseURLDevice to your Mac LAN IP (e.g. http://192.168.1.12:8001)."
            } else {
                hint = "Could not connect to backend. Ensure FastAPI is running (currently expected on :8001)."
            }
            let attemptedJoined = attempted.joined(separator: ", ")
            throw NSError(
                domain: "APIService",
                code: urlError.errorCode,
                userInfo: [
                    NSLocalizedDescriptionKey: "\(hint) Tried: \(attemptedJoined)"
                ]
            )
        }
        throw lastError ?? URLError(.cannotConnectToHost)
    }

    private func shouldRetryOnAlternateBase(error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .timedOut:
            return true
        default:
            return false
        }
    }

    private static func isPhysicalDeviceLoopback(baseURL: URL) -> Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        let host = baseURL.host?.lowercased()
        return host == "127.0.0.1" || host == "localhost"
        #endif
    }
}
