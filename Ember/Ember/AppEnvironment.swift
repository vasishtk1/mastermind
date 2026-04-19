import SwiftUI
import Combine

/// Owns long-lived services so networking + polling share one `APIService` instance.
@MainActor
final class AppEnvironment: ObservableObject {
    let api: APIService
    let profileSync: ProfileSyncCoordinator

    @Published var patientId: String

    init(
        patientId: String = "demo-patient-001"
    ) {
        guard let baseURL = URL(string: "http://localhost:8000") else {
            fatalError("Invalid base URL")
        }
        let api = APIService(baseURL: baseURL)
        self.api = api
        self.patientId = patientId
        self.profileSync = ProfileSyncCoordinator(api: api, patientId: patientId)
    }

    func setPatientId(_ newValue: String) {
        patientId = newValue
        profileSync.updatePatientId(newValue)
        Task { await profileSync.syncNow() }
    }
}
