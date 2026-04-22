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
                ScrollView {
                    VStack(spacing: 18) {
                        EmberCard {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "person.crop.circle.fill")
                                    .font(.largeTitle)
                                    .foregroundStyle(EmberTheme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(vm.patientName)
                                        .font(.headline)
                                        .foregroundStyle(EmberTheme.textPrimary)
                                    Text(env.patientId)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(EmberTheme.textSecondary)
                                    Text("MasterMind Daily Plan")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(EmberTheme.accent)
                                        .padding(.top, 2)
                                }
                                Spacer()
                            }
                        }

                        groupedCard(title: "Profile") {
                            row("Email", vm.patientEmail)
                            divider
                            row("Phone", vm.patientPhone)
                            divider
                            NavigationLink {
                                EditPatientProfileView(vm: vm)
                            } label: {
                                HStack {
                                    Text("Edit patient profile")
                                        .font(.subheadline)
                                        .foregroundStyle(EmberTheme.accent)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(EmberTheme.textSecondary)
                                }
                            }
                        }

                        groupedCard(title: "Care team") {
                            row("Clinician", vm.clinicianName)
                            divider
                            row("Clinic", vm.clinicianClinic)
                            divider
                            row("Email", vm.clinicianEmail)
                            divider
                            row("Last sync", vm.lastDoctorSync.formatted(date: .abbreviated, time: .shortened))
                            divider
                            Button {
                                vm.runDummySync()
                            } label: {
                                HStack {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                    Text("Sync with doctor")
                                }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.accent)
                            }
                        }

                        groupedCard(title: "Preferences") {
                            NavigationLink {
                                ReminderPreferencesView(env: env)
                            } label: {
                                HStack {
                                    Image(systemName: "bell.fill")
                                        .foregroundStyle(EmberTheme.accent)
                                    Text("Reminder preferences")
                                        .font(.subheadline)
                                        .foregroundStyle(EmberTheme.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(EmberTheme.textSecondary)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private func groupedCard<Content: View>(title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(EmberTheme.textSecondary)
                .padding(.horizontal, 4)
            EmberCard {
                VStack(alignment: .leading, spacing: 10) {
                    content()
                }
            }
        }
    }

    private var divider: some View {
        Divider().overlay(EmberTheme.cardBorder)
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key)
                .font(.caption.weight(.semibold))
                .foregroundStyle(EmberTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline.monospacedDigit())
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
