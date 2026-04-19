import SwiftUI
import Combine
import UserNotifications

enum ReminderCadence: String, CaseIterable, Sendable {
    case hourly
    case daily
    case weekly
}

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
    @Published var remindersEnabled: Bool
    @Published var reminderCadence: ReminderCadence
    @Published var reminderHour: Int
    @Published var reminderMinute: Int
    @Published var reminderWeekday: Int

    private let notificationRouter = EmberNotificationRouter()
    private var directivesTask: Task<Void, Never>?
    private var didStartEscalationServices = false
    private let reminderNotificationID = "mastermind.journal.reminder"

    private static let reminderEnabledKey = "mastermind.reminders.enabled"
    private static let reminderCadenceKey = "mastermind.reminders.cadence"
    private static let reminderHourKey = "mastermind.reminders.hour"
    private static let reminderMinuteKey = "mastermind.reminders.minute"
    private static let reminderWeekdayKey = "mastermind.reminders.weekday"
    private static let lastDirectiveNotificationIDKey = "mastermind.notifications.lastDirectiveID"

    init(
        patientId: String = "pat-test-1"
    ) {
        let defaults = UserDefaults.standard
        let cadenceRaw = defaults.string(forKey: Self.reminderCadenceKey) ?? ReminderCadence.daily.rawValue
        let cadence = ReminderCadence(rawValue: cadenceRaw) ?? .daily
        let currentHour = Calendar.current.component(.hour, from: Date())
        let currentMinute = Calendar.current.component(.minute, from: Date())
        let currentWeekday = Calendar.current.component(.weekday, from: Date())

        let baseURL = Bundle.main.emberAPIBaseURL
        let api = APIService(baseURL: baseURL)
        self.api = api
        self.patientId = patientId
        self.profileSync = ProfileSyncCoordinator(api: api, patientId: patientId)
        self.telemetry = TelemetryOrchestrator()
        self.remindersEnabled = defaults.object(forKey: Self.reminderEnabledKey) as? Bool ?? true
        self.reminderCadence = cadence
        self.reminderHour = defaults.object(forKey: Self.reminderHourKey) as? Int ?? currentHour
        self.reminderMinute = defaults.object(forKey: Self.reminderMinuteKey) as? Int ?? currentMinute
        self.reminderWeekday = defaults.object(forKey: Self.reminderWeekdayKey) as? Int ?? currentWeekday
        self.notificationRouter.onOpenActiveAssessment = { [weak self] in
            self?.showActiveAssessment = true
        }
        UNUserNotificationCenter.current().delegate = notificationRouter
        tripwire.onScoreUpdate = { [weak self] score in
            Task { @MainActor in
                self?.latestTripwireScore = score
            }
        }
        Task { [weak self] in
            await self?.scheduleJournalReminders()
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
                // Keep tripwire status updates without foreground spam notifications.
                tripwire.emitsLocalNotifications = false
                tripwire.cooldownSec = 6 * 60 * 60
                try await tripwire.start()
            } catch {
                print("[Ember][Tripwire] start failed: \(error.localizedDescription)")
            }
        }
        startDirectivePolling()
    }

    func applyReminderPreferences(
        enabled: Bool,
        cadence: ReminderCadence,
        hour: Int,
        minute: Int,
        weekday: Int
    ) {
        remindersEnabled = enabled
        reminderCadence = cadence
        reminderHour = max(0, min(23, hour))
        reminderMinute = max(0, min(59, minute))
        reminderWeekday = max(1, min(7, weekday))

        let defaults = UserDefaults.standard
        defaults.set(remindersEnabled, forKey: Self.reminderEnabledKey)
        defaults.set(reminderCadence.rawValue, forKey: Self.reminderCadenceKey)
        defaults.set(reminderHour, forKey: Self.reminderHourKey)
        defaults.set(reminderMinute, forKey: Self.reminderMinuteKey)
        defaults.set(reminderWeekday, forKey: Self.reminderWeekdayKey)

        Task { [weak self] in
            await self?.scheduleJournalReminders()
        }
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
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: Self.lastDirectiveNotificationIDKey)
        if last == directive.id {
            return
        }
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
        if (try? await UNUserNotificationCenter.current().add(request)) != nil {
            defaults.set(directive.id, forKey: Self.lastDirectiveNotificationIDKey)
        }
    }

    private func scheduleJournalReminders() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else {
            return
        }

        center.removePendingNotificationRequests(withIdentifiers: [reminderNotificationID])
        guard remindersEnabled else { return }

        let content = UNMutableNotificationContent()
        content.title = "MasterMind check-in"
        content.body = "Take a moment for your voice or video journal."
        content.sound = .default
        content.userInfo = ["ember_route": "journal_home"]

        let trigger: UNNotificationTrigger
        switch reminderCadence {
        case .hourly:
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: true)
        case .daily:
            var comps = DateComponents()
            comps.hour = reminderHour
            comps.minute = reminderMinute
            trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
        case .weekly:
            var comps = DateComponents()
            comps.weekday = reminderWeekday
            comps.hour = reminderHour
            comps.minute = reminderMinute
            trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
        }

        let request = UNNotificationRequest(identifier: reminderNotificationID, content: content, trigger: trigger)
        try? await center.add(request)
    }
}
