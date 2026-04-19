import Foundation
import Combine

/// Polls clinician profile every 60 seconds and applies it to `CactusManager`.
@MainActor
final class ProfileSyncCoordinator: ObservableObject {
    private let api: APIService
    private var patientId: String
    private var timer: AnyCancellable?

    @Published private(set) var lastSync: Date?
    @Published private(set) var lastSyncError: String?

    init(api: APIService, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    func updatePatientId(_ newValue: String) {
        patientId = newValue
    }

    func start() {
        timer?.cancel()
        timer = Timer.publish(every: 60, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                Task { await self?.syncNow() }
            }

        Task { await syncNow() }
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    func syncNow() async {
        do {
            let profile = try await api.fetchClinicianProfile(patientId: patientId)
            CactusManager.shared.applyClinicianProfile(profile)
            lastSync = Date()
            lastSyncError = nil
        } catch {
            lastSyncError = error.localizedDescription
        }
    }
}
