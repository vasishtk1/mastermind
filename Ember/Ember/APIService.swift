import Foundation

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
}
