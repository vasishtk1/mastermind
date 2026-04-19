import Foundation
import UniformTypeIdentifiers

/// Native `URLSession` client for the Ember FastAPI backend.
final class APIService: ObservableObject {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

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
    }

    // MARK: - Push

    func uploadEvent(event: IncomingDeviceEvent) async throws {
        let url = baseURL.appendingPathComponent("api/events")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(event)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST /api/events failed with status \(http.statusCode)"]
            )
        }
    }

    func uploadIncident(text: String, facialData: [String: Double], gemmaAction: String) async throws {
        let url = baseURL.appendingPathComponent("api/incidents")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "text": text,
            "facial_data": facialData,
            "gemma_action": gemmaAction,
            "created_at": ISO8601DateFormatter().string(from: Date()),
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "APIService", code: 500, userInfo: [NSLocalizedDescriptionKey: "POST /api/incidents failed"])
        }
    }

    func uploadJournalMedia(
        fileURL: URL,
        patientId: String,
        journalKind: JournalEntryKind,
        noteText: String
    ) async throws {
        let url = baseURL.appendingPathComponent("api/journals/upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

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

        request.httpBody = body
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(
                domain: "APIService",
                code: 500,
                userInfo: [NSLocalizedDescriptionKey: "POST /api/journals/upload failed"]
            )
        }
    }

    // MARK: - Pull

    func fetchClinicianProfile(patientId: String) async throws -> ClinicianProfile {
        let safePatientId = patientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? patientId
        let url = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("patients")
            .appendingPathComponent(safePatientId)
            .appendingPathComponent("profile")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
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
        let url = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("patients")
            .appendingPathComponent(safePatientId)
            .appendingPathComponent("directives")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
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
}
