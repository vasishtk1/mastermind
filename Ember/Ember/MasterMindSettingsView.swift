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
                            ReminderPreferencesView(vm: vm)
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
    @ObservedObject var vm: MasterMindProfileViewModel

    var body: some View {
        Form {
            Section("Journal reminders") {
                Toggle("Daily reminder", isOn: $vm.prefersDailyReminder)
                DatePicker("Preferred time", selection: $vm.preferredReminderTime, displayedComponents: .hourAndMinute)
                    .disabled(!vm.prefersDailyReminder)
            }
        }
        .navigationTitle("Reminder Preferences")
    }
}
