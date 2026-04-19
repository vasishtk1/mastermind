import SwiftUI
import Combine

extension Bundle {
    /// Base URL for the FastAPI backend. Override `APIBaseURL` in Info.plist — use your Mac’s LAN IP when running on a physical device (e.g. `http://192.168.1.12:8000`).
    var emberAPIBaseURL: URL {
        if let s = object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
           !s.isEmpty {
            return u
        }
        return URL(string: "http://127.0.0.1:8000")!
    }

    /// When `false` (default), Ember does not poll `/api/patients/.../profile` — avoids connection-refused noise when no FastAPI process is running.
    var emberBackendSyncEnabled: Bool {
        object(forInfoDictionaryKey: "EmberBackendSyncEnabled") as? Bool ?? false
    }
}

/// Owns long-lived services so networking + polling share one `APIService` instance.
@MainActor
final class AppEnvironment: ObservableObject {
    let api: APIService
    let profileSync: ProfileSyncCoordinator
    let telemetry: TelemetryOrchestrator

    @Published var patientId: String

    init(
        patientId: String = "demo-patient-001"
    ) {
        let baseURL = Bundle.main.emberAPIBaseURL
        let api = APIService(baseURL: baseURL)
        self.api = api
        self.patientId = patientId
        self.profileSync = ProfileSyncCoordinator(api: api, patientId: patientId)
        self.telemetry = TelemetryOrchestrator()
    }

    func setPatientId(_ newValue: String) {
        patientId = newValue
        profileSync.updatePatientId(newValue)
        Task { await profileSync.syncNow() }
    }
}
