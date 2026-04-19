import SwiftUI

@MainActor
final class MasterMindProfileViewModel: ObservableObject {
    @Published var patientName = "Priya Sharma"
    @Published var patientEmail = "priya@example.com"
    @Published var patientPhone = "(555) 123-1209"
    @Published var clinicianName = "Dr. T. Raman, MD"
    @Published var clinicianClinic = "MasterMind Behavioral Health"
    @Published var clinicianEmail = "dr.t@mastermindhealth.org"
    @Published var prefersDailyReminder = true
    @Published var preferredReminderTime = Date.now
    @Published var lastDoctorSync = Date.now.addingTimeInterval(-86_400)

    func runDummySync() {
        lastDoctorSync = Date.now
    }
}

struct MasterMindSettingsView: View {
    @ObservedObject var env: AppEnvironment
    @StateObject private var vm = MasterMindProfileViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                List {
                    Section {
                        EmberCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Patient Settings")
                                    .font(.headline.weight(.bold))
                                    .foregroundStyle(EmberTheme.textPrimary)
                                Text("Manage your profile and care-team sync preferences.")
                                    .font(.footnote)
                                    .foregroundStyle(EmberTheme.textSecondary)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)

                    Section("Profile") {
                        row("Name", vm.patientName)
                        row("Email", vm.patientEmail)
                        row("Phone", vm.patientPhone)
                        row("Patient ID", env.patientId)
                        NavigationLink("Edit patient profile") {
                            EditPatientProfileView(vm: vm)
                        }
                    }

                    Section("Doctor") {
                        row("Clinician", vm.clinicianName)
                        row("Clinic", vm.clinicianClinic)
                        row("Email", vm.clinicianEmail)
                        row("Last sync", vm.lastDoctorSync.formatted(date: .abbreviated, time: .shortened))
                        Button("Sync with doctor (dummy)") {
                            vm.runDummySync()
                        }
                        .foregroundStyle(EmberTheme.accent)
                    }

                    Section("Preferences") {
                        NavigationLink("Reminder preferences") {
                            ReminderPreferencesView(env: env)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(EmberTheme.background)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key)
                .font(.caption2)
                .foregroundStyle(EmberTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct EditPatientProfileView: View {
    @ObservedObject var vm: MasterMindProfileViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Patient Profile") {
                TextField("Name", text: $vm.patientName)
                TextField("Email", text: $vm.patientEmail)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                TextField("Phone", text: $vm.patientPhone)
                    .keyboardType(.phonePad)
            }
        }
        .navigationTitle("Edit Profile")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    dismiss()
                }
                .foregroundStyle(EmberTheme.accent)
            }
        }
    }
}

struct ReminderPreferencesView: View {
    @ObservedObject var env: AppEnvironment

    @State private var remindersEnabled: Bool = true
    @State private var cadence: ReminderCadence = .daily
    @State private var reminderTime: Date = Date()
    @State private var weekday: Int = 2 // Monday

    var body: some View {
        Form {
            Section("Journal reminders") {
                Toggle("Enable reminders", isOn: $remindersEnabled)

                Picker("Frequency", selection: $cadence) {
                    Text("Hourly").tag(ReminderCadence.hourly)
                    Text("Daily").tag(ReminderCadence.daily)
                    Text("Weekly").tag(ReminderCadence.weekly)
                }
                .disabled(!remindersEnabled)

                if cadence != .hourly {
                    DatePicker("Preferred time", selection: $reminderTime, displayedComponents: .hourAndMinute)
                        .disabled(!remindersEnabled)
                }

                if cadence == .weekly {
                    Picker("Day of week", selection: $weekday) {
                        ForEach(1...7, id: \.self) { index in
                            Text(weekdayLabel(index)).tag(index)
                        }
                    }
                    .disabled(!remindersEnabled)
                }
            }
        }
        .navigationTitle("Reminder Preferences")
        .onAppear {
            remindersEnabled = env.remindersEnabled
            cadence = env.reminderCadence
            weekday = env.reminderWeekday
            reminderTime = dateFrom(hour: env.reminderHour, minute: env.reminderMinute)
        }
        .onChange(of: remindersEnabled) { _, _ in persist() }
        .onChange(of: cadence) { _, _ in persist() }
        .onChange(of: reminderTime) { _, _ in persist() }
        .onChange(of: weekday) { _, _ in persist() }
    }

    private func persist() {
        let comps = Calendar.current.dateComponents([.hour, .minute], from: reminderTime)
        env.applyReminderPreferences(
            enabled: remindersEnabled,
            cadence: cadence,
            hour: comps.hour ?? 9,
            minute: comps.minute ?? 0,
            weekday: weekday
        )
    }

    private func dateFrom(hour: Int, minute: Int) -> Date {
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        comps.hour = hour
        comps.minute = minute
        return Calendar.current.date(from: comps) ?? Date()
    }

    private func weekdayLabel(_ index: Int) -> String {
        let symbols = Calendar.current.weekdaySymbols
        let i = max(1, min(7, index)) - 1
        return symbols[i]
    }
}
