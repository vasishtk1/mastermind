import SwiftUI
import Combine
import UserNotifications

enum ReminderCadence: String, CaseIterable, Sendable {
    case hourly
    case daily
    case weekly
}

extension Bundle {
    /// Base URL for the FastAPI backend.
    /// - Simulator: `APIBaseURL` (defaults to localhost)
    /// - Physical iPhone: prefers optional `APIBaseURLDevice`, otherwise falls back to `APIBaseURL`.
    ///   Use your Mac's LAN IP on device (e.g. `http://192.168.1.12:8001`), not localhost.
    var emberAPIBaseURL: URL {
        #if targetEnvironment(simulator)
        let key = "APIBaseURL"
        #else
        let key = "APIBaseURLDevice"
        #endif

        if let s = object(forInfoDictionaryKey: key) as? String,
           let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
           !s.isEmpty {
            return u
        }
        if key != "APIBaseURL",
           let s = object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
           !s.isEmpty {
            return u
        }
        return URL(string: "http://127.0.0.1:8001")!
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
    let convex: ConvexClient
    let profileSync: ProfileSyncCoordinator
    let telemetry: TelemetryOrchestrator
    let tripwire = AudioTripwireManager()

    @Published var patientId: String
    @Published var showActiveAssessment = false
    @Published var latestTripwireScore: Double = 0
    @Published var directives: [ClinicianDirective] = []
    @Published var directivesLoading: Bool = false
    @Published var directivesError: String?
    @Published var remindersEnabled: Bool
    @Published var reminderCadence: ReminderCadence
    @Published var reminderHour: Int
    @Published var reminderMinute: Int
    @Published var reminderWeekday: Int

    // Passive (always-on) monitoring surfaced under the directives panel on
    // the home tab. Mirrors the underlying tripwire service state so SwiftUI
    // can render a toggle, last-detection timestamp, and an "X passive
    // incidents shared" counter.
    @Published var passiveMonitoringEnabled: Bool
    @Published var passiveMonitoringActive: Bool = false
    @Published var passiveMonitoringStarting: Bool = false
    @Published var passiveMonitoringError: String?
    @Published var lastPassiveDetectionAt: Date?
    @Published var passiveIncidentCount: Int = 0

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
    private static let passiveMonitoringEnabledKey = "mastermind.passiveMonitoring.enabled"

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
        self.convex = ConvexClient()
        self.patientId = patientId
        self.profileSync = ProfileSyncCoordinator(api: api, patientId: patientId)
        self.telemetry = TelemetryOrchestrator()
        self.remindersEnabled = defaults.object(forKey: Self.reminderEnabledKey) as? Bool ?? true
        self.reminderCadence = cadence
        self.reminderHour = defaults.object(forKey: Self.reminderHourKey) as? Int ?? currentHour
        self.reminderMinute = defaults.object(forKey: Self.reminderMinuteKey) as? Int ?? currentMinute
        self.reminderWeekday = defaults.object(forKey: Self.reminderWeekdayKey) as? Int ?? currentWeekday
        self.passiveMonitoringEnabled = defaults.object(forKey: Self.passiveMonitoringEnabledKey) as? Bool ?? false
        self.notificationRouter.onOpenActiveAssessment = { [weak self] in
            self?.showActiveAssessment = true
        }
        UNUserNotificationCenter.current().delegate = notificationRouter
        tripwire.onScoreUpdate = { [weak self] score in
            Task { @MainActor in
                self?.latestTripwireScore = score
            }
        }
        tripwire.onSpeechDetected = { [weak self] pcm in
            Task { @MainActor in
                self?.handlePassiveDetection(pcm: pcm)
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
        // Configure the underlying tripwire defaults once. Whether it
        // actually runs is governed by `passiveMonitoringEnabled` so the
        // user has a clear opt-in toggle.
        tripwire.emitsLocalNotifications = false
        tripwire.cooldownSec = 6 * 60 * 60
        if passiveMonitoringEnabled {
            Task { [weak self] in
                await self?.startPassiveMonitoring()
            }
        }
        startDirectivePolling()
    }

    // MARK: - Passive monitoring (always-on listener)

    /// Toggles the always-on tripwire on/off. Persists the choice so the
    /// listener resumes on next launch when `startEscalationProtocolIfNeeded`
    /// runs.
    func setPassiveMonitoringEnabled(_ enabled: Bool) {
        passiveMonitoringEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.passiveMonitoringEnabledKey)
        Task { [weak self] in
            if enabled {
                await self?.startPassiveMonitoring()
            } else {
                await self?.stopPassiveMonitoring()
            }
        }
    }

    private func startPassiveMonitoring() async {
        guard !passiveMonitoringActive else { return }
        passiveMonitoringStarting = true
        passiveMonitoringError = nil
        do {
            try await tripwire.start()
            passiveMonitoringActive = true
        } catch {
            passiveMonitoringError = error.localizedDescription
            passiveMonitoringActive = false
            // Roll the persisted toggle back so the UI reflects reality.
            passiveMonitoringEnabled = false
            UserDefaults.standard.set(false, forKey: Self.passiveMonitoringEnabledKey)
        }
        passiveMonitoringStarting = false
    }

    private func stopPassiveMonitoring() async {
        tripwire.stop()
        passiveMonitoringActive = false
        latestTripwireScore = 0
    }

    /// Fires the passive-detection pipeline end-to-end with synthesized
    /// audio. Use on stage / in demo settings when you can't rely on the
    /// ambient environment being loud enough to trip the real detector.
    /// Works whether or not the live listener is running — the synthetic
    /// buffer goes straight through `handlePassiveDetection` and into
    /// Convex.
    func simulatePassiveDetection() {
        let pcm = AudioTripwireManager.syntheticSpeechBurstData(
            sampleRate: tripwire.sampleRate,
            seconds: 2.0
        )
        handlePassiveDetection(pcm: pcm)
    }

    /// Called when the tripwire crosses its threshold. Snapshots the most
    /// recent few seconds of mic audio, derives biometrics, and writes a
    /// passive incident into Convex so it shows up in the clinician
    /// dashboard alongside intentional journal entries.
    private func handlePassiveDetection(pcm: Data) {
        lastPassiveDetectionAt = Date()
        let metrics = AudioFeatureExtractor.compute(fromPCM16LE: pcm, sampleRate: tripwire.sampleRate)
        let neutralFacial = JournalTelemetryAnalyzer.FacialTelemetry(
            facialStressScore: 0,
            browFurrowScore: 0,
            jawTightnessScore: 0
        )
        let pid = patientId
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await self.convex.ingestJournal(
                    patientId: pid,
                    patientName: nil,
                    journalKind: .voice,
                    noteText: "Cactus VAD detected elevated acoustic activity on the patient's device.",
                    audio: metrics,
                    facial: neutralFacial,
                    gemmaGroundingAction: "cactus_vad",
                    gemmaModelResponse: "Cactus VAD on-device tripwire fired while the app was running in the background.",
                    gemmaSuccess: true,
                    gemmaTotalTimeMs: 0,
                    gemmaRawJSON: "",
                    context: ["source": "passive_monitor", "detector": "cactus_vad"]
                )
                await MainActor.run {
                    self.passiveIncidentCount += 1
                }
            } catch {
                print("[Ember][PassiveMonitor] convex ingest failed: \(error.localizedDescription)")
            }
        }
    }

    /// One-shot Convex directive refresh. Safe to call from the UI (pull to
    /// refresh / `task` modifier).
    func refreshDirectives() async {
        await fetchDirectivesOnce()
    }

    /// Drops every directive currently held in memory and resets the
    /// notification-dedupe marker so the next clinician deployment is treated
    /// as fresh. Does **not** touch Convex — callers that want the upstream
    /// row gone too should also call the `directives:clearAll` mutation.
    ///
    /// On the home screen this immediately empties the active directives
    /// list and the "Tuned by Dr. Raman" tunable-metric pill (which is
    /// derived from the latest directive's `[Tunable]` token).
    func clearCachedDirectives() {
        directives = []
        directivesError = nil
        UserDefaults.standard.removeObject(forKey: Self.lastDirectiveNotificationIDKey)
    }

    /// Mark a directive as read on the Convex deployment. Optimistically
    /// updates the local cache so the UI updates immediately even if the
    /// network call is in flight.
    func acknowledgeDirective(_ directive: ClinicianDirective) async {
        if let idx = directives.firstIndex(where: { $0.id == directive.id }) {
            directives[idx].acknowledged = true
        }
        do {
            try await convex.acknowledgeDirective(directiveId: directive.id)
        } catch {
            print("[Ember] Acknowledge directive failed: \(error.localizedDescription)")
        }
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
                await self.fetchDirectivesOnce()
                // 10 s — directives are the headline content on the home tab,
                // so we want the patient to see clinician deployments almost
                // immediately. Pull-to-refresh + the manual refresh button
                // also call `fetchDirectivesOnce` directly.
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private func fetchDirectivesOnce() async {
        await MainActor.run { self.directivesLoading = true }
        do {
            let fetched = try await convex.listDirectives(patientId: patientId)
            await MainActor.run {
                self.directives = fetched
                self.directivesLoading = false
                self.directivesError = nil
            }
            if let latest = fetched.first {
                await Self.sendDirectiveNotificationIfNeeded(directive: latest)
            }
        } catch {
            await MainActor.run {
                self.directivesLoading = false
                self.directivesError = error.localizedDescription
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
        content.title = "New directive from your clinician"
        content.body = directive.displayTitle + " — " + directive.displayInstructions
        content.sound = .default
        content.userInfo = ["ember_route": "directives", "directive_id": directive.id]
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
