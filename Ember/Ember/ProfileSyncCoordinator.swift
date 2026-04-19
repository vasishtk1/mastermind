import Foundation
import Combine

/// Polls clinician profile every 60 seconds and applies it to `CactusManager`.
/// Set `EmberBackendSyncEnabled` to `true` in Info.plist when FastAPI is reachable (disabled by default to avoid log spam offline).
@MainActor
final class ProfileSyncCoordinator: ObservableObject {
    private let api: APIService
    private var patientId: String
    private var timer: AnyCancellable?

    @Published private(set) var lastSync: Date?
    @Published private(set) var lastSyncError: String?

    private var isSyncEnabled: Bool { Bundle.main.emberBackendSyncEnabled }

    init(api: APIService, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    func updatePatientId(_ newValue: String) {
        patientId = newValue
    }

    func start() {
        guard isSyncEnabled else {
            lastSyncError = nil
            return
        }
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
        guard isSyncEnabled else {
            lastSyncError = nil
            return
        }
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
