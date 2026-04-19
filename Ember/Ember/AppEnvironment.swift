import SwiftUI
import Combine
import UserNotifications

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
    let tripwire = AudioTripwireManager()

    @Published var patientId: String
    @Published var showActiveAssessment = false
    @Published var latestTripwireScore: Double = 0
    @Published var directives: [ClinicianDirective] = []

    private let notificationRouter = EmberNotificationRouter()
    private var directivesTask: Task<Void, Never>?
    private var didStartEscalationServices = false

    init(
        patientId: String = "pat-test-1"
    ) {
        let baseURL = Bundle.main.emberAPIBaseURL
        let api = APIService(baseURL: baseURL)
        self.api = api
        self.patientId = patientId
        self.profileSync = ProfileSyncCoordinator(api: api, patientId: patientId)
        self.telemetry = TelemetryOrchestrator()
        self.notificationRouter.onOpenActiveAssessment = { [weak self] in
            self?.showActiveAssessment = true
        }
        UNUserNotificationCenter.current().delegate = notificationRouter
        tripwire.onScoreUpdate = { [weak self] score in
            Task { @MainActor in
                self?.latestTripwireScore = score
            }
        }
    }

    func setPatientId(_ newValue: String) {
        patientId = newValue
        profileSync.updatePatientId(newValue)
        Task { await profileSync.syncNow() }
    }

    func startEscalationProtocolIfNeeded() {
        guard !didStartEscalationServices else { return }
        didStartEscalationServices = true
        Task {
            do {
                try await tripwire.start()
            } catch {
                print("[Ember][Tripwire] start failed: \(error.localizedDescription)")
            }
        }
        startDirectivePolling()
    }

    private func startDirectivePolling() {
        directivesTask?.cancel()
        directivesTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    let directives = try await self.api.fetchClinicianDirectives(patientId: self.patientId)
                    await MainActor.run {
                        self.directives = directives
                    }
                    if let latest = directives.first {
                        await Self.sendDirectiveNotificationIfNeeded(directive: latest)
                    }
                } catch {
                    // Keep polling in background without surfacing noisy errors.
                }
                try? await Task.sleep(nanoseconds: 300_000_000_000) // 5 min
            }
        }
    }

    private static func sendDirectiveNotificationIfNeeded(directive: ClinicianDirective) async {
        let content = UNMutableNotificationContent()
        content.title = "New clinician activity"
        content.body = directive.title
        content.sound = .default
        content.userInfo = ["ember_route": "active_assessment", "directive_id": directive.id]
        let request = UNNotificationRequest(
            identifier: "ember.directive.\(directive.id)",
            content: content,
            trigger: nil
        )
        _ = try? await UNUserNotificationCenter.current().add(request)
    }
}
