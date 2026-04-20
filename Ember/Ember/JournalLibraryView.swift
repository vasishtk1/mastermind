import SwiftUI

struct JournalLibraryView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore

    @State private var showDoctorDataNotice = false
    @State private var activeCaptureKind: JournalEntryKind?
    @State private var filter: KindFilter = .all

    private enum KindFilter: String, CaseIterable, Identifiable {
        case all, video, voice
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: return "All"
            case .video: return "Video"
            case .voice: return "Voice"
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                List {
                    Section {
                        EmberCard {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Your journal history")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(EmberTheme.textPrimary)
                                Text("Tap any entry to review the biometrics your clinician saw.")
                                    .font(.caption)
                                    .foregroundStyle(EmberTheme.textSecondary)
                                Picker("Filter", selection: $filter) {
                                    ForEach(KindFilter.allCases) { f in
                                        Text(f.label).tag(f)
                                    }
                                }
                                .pickerStyle(.segmented)
                                .padding(.top, 4)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))

                    Section {
                        if filteredSessions.isEmpty {
                            EmberCard {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "book.closed")
                                        .font(.title3)
                                        .foregroundStyle(EmberTheme.accent)
                                        .frame(width: 28, height: 28)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .fill(EmberTheme.accentMuted)
                                        )
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("No journals yet")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(EmberTheme.textPrimary)
                                        Text("Tap the + button to record your first check-in.")
                                            .font(.footnote)
                                            .foregroundStyle(EmberTheme.textSecondary)
                                    }
                                }
                            }
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
                        } else {
                            ForEach(filteredSessions) { session in
                                NavigationLink {
                                    JournalDetailView(session: session, videoURL: store.videoURL(for: session))
                                } label: {
                                    JournalRow(session: session)
                                }
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
                            }
                            .onDelete(perform: deleteJournals)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(EmberTheme.background)
            }
            .navigationTitle("Journal")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            activeCaptureKind = .video
                        } label: {
                            Label("New Video Journal", systemImage: "video.fill")
                        }
                        Button {
                            activeCaptureKind = .voice
                        } label: {
                            Label("New Voice Journal", systemImage: "waveform")
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundStyle(EmberTheme.accent)
                    }
                }
            }
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

    private var filteredSessions: [JournalSession] {
        switch filter {
        case .all: return store.sessions
        case .video: return store.sessions.filter { $0.kind == .video }
        case .voice: return store.sessions.filter { $0.kind == .voice }
        }
    }

    private func deleteJournals(at offsets: IndexSet) {
        // Translate filtered index → absolute store index.
        let visible = filteredSessions
        let storeIndexes = IndexSet(offsets.compactMap { (offset: Int) -> Int? in
            guard visible.indices.contains(offset) else { return nil }
            let target = visible[offset]
            return store.sessions.firstIndex(where: { $0.id == target.id })
        })
        let shouldWarn = store.delete(at: storeIndexes)
        if shouldWarn {
            showDoctorDataNotice = true
        }
    }
}

private struct JournalRow: View {
    let session: JournalSession

    var body: some View {
        EmberCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: session.kind == .video ? "video.fill" : "waveform")
                    .font(.headline)
                    .foregroundStyle(EmberTheme.accent)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(EmberTheme.accentMuted)
                    )
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberTheme.textPrimary)
                    HStack(spacing: 6) {
                        chip(text: session.kind == .video ? "Video" : "Voice", tint: EmberTheme.accent)
                        chip(
                            text: session.journalSharedWithClinician ? "Shared" : "Private",
                            tint: session.journalSharedWithClinician ? Color.green : EmberTheme.textSecondary
                        )
                    }
                    Text(session.gemmaAction)
                        .font(.footnote)
                        .foregroundStyle(EmberTheme.textPrimary.opacity(0.85))
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EmberTheme.textSecondary)
            }
        }
    }

    private func chip(text: String, tint: Color) -> some View {
        Text(text.uppercased())
            .font(.system(size: 9, weight: .bold))
            .tracking(0.6)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(tint.opacity(0.18)))
    }
}
