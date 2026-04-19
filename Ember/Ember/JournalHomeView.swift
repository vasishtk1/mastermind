import SwiftUI

struct JournalHomeView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore
    @State private var showDoctorDataNotice = false
    @State private var activeCaptureKind: JournalEntryKind?

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                List {
                    Section {
                        positiveMessageCard
                        quickJournalActions
                        patientAndDoctorSection
                    }
                    .listRowBackground(Color.clear)

                    Section("Saved Journals") {
                        if store.sessions.isEmpty {
                            Text("No journal sessions yet. Start with a voice or video check-in.")
                                .font(.footnote)
                                .foregroundStyle(EmberTheme.textSecondary)
                                .listRowBackground(Color.clear)
                        } else {
                            ForEach(store.sessions) { session in
                                NavigationLink {
                                    JournalDetailView(session: session, videoURL: store.videoURL(for: session))
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(session.createdAt.formatted(date: .abbreviated, time: .shortened))
                                            .font(.headline)
                                        HStack(spacing: 6) {
                                            Text(session.kind == .video ? "Video" : "Voice")
                                                .font(.caption2)
                                                .foregroundStyle(EmberTheme.textSecondary)
                                            Text(session.journalSharedWithClinician ? "Shared" : "Private")
                                                .font(.caption2)
                                                .foregroundStyle(session.journalSharedWithClinician ? Color.green : EmberTheme.textSecondary)
                                        }
                                        Text(session.gemmaAction)
                                            .font(.subheadline)
                                            .foregroundStyle(EmberTheme.textSecondary)
                                            .lineLimit(2)
                                    }
                                    .padding(.vertical, 4)
                                }
                                .listRowBackground(Color.clear)
                            }
                            .onDelete(perform: deleteJournals)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(EmberTheme.background)
            }
            .navigationTitle("MasterMind")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Journal deleted", isPresented: $showDoctorDataNotice) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("This removed only your local copy. Data already sent to your doctor remains in the clinician system.")
            }
            .sheet(item: $activeCaptureKind) { kind in
                NavigationStack {
                    JournalCaptureView(env: env, store: store, initialKind: kind, lockKindSelection: true)
                        .id(kind.rawValue)
                }
            }
        }
    }

    private var positiveMessageCard: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(greetingLine)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(EmberTheme.textPrimary)
                Text("Weather vibe: \(weatherLine)")
                    .font(.subheadline)
                    .foregroundStyle(EmberTheme.textSecondary)
                Text("Mood note: \(moodLine)")
                    .font(.subheadline)
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private var quickJournalActions: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Start a check-in")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                HStack(spacing: 10) {
                    Button {
                        activeCaptureKind = .video
                    } label: {
                        actionPill(title: "Video Journal", systemName: "video.fill")
                    }
                    .buttonStyle(.plain)
                    Button {
                        activeCaptureKind = .voice
                    } label: {
                        actionPill(title: "Voice Journal", systemName: "waveform.mic")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var patientAndDoctorSection: some View {
        EmberCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Care Team Snapshot")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
                Divider().overlay(EmberTheme.cardBorder)
                row("Patient", "Priya Sharma")
                row("Patient ID", env.patientId)
                row("Primary Doctor", "Dr. T. Raman, MD")
                row("Program", "MasterMind Daily Journal Plan")
                row("Recommended cadence", "1 journal/day")
                row("Last clinician sync", syncStatusText)
                row("Latest directive", env.directives.first?.title ?? "No new directives")
            }
        }
    }

    private var greetingLine: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning, Priya. Small steps still count." }
        if hour < 18 { return "Good afternoon, Priya. You are doing better than you think." }
        return "Good evening, Priya. Reflecting tonight can lighten tomorrow."
    }

    private var weatherLine: String {
        let day = Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 1
        switch day % 3 {
        case 0: return "Sunny and steady"
        case 1: return "Cloudy but calm"
        default: return "Cool and restorative"
        }
    }

    private var moodLine: String {
        "You are not alone. A short check-in can help you feel supported and understood."
    }

    private var syncStatusText: String {
        if let d = env.profileSync.lastSync {
            return d.formatted(date: .abbreviated, time: .shortened)
        }
        if let err = env.profileSync.lastSyncError, !err.isEmpty {
            return "Pending (\(err))"
        }
        return "Planned (dummy sync mode)"
    }

    private func deleteJournals(at offsets: IndexSet) {
        let shouldWarn = store.delete(at: offsets)
        if shouldWarn {
            showDoctorDataNotice = true
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

    private func actionPill(title: String, systemName: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemName)
            Text(title)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(EmberTheme.textPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(EmberTheme.cardBorder, lineWidth: 1)
                )
        )
    }
}
