import SwiftUI

struct JournalLibraryView: View {
    @ObservedObject var env: AppEnvironment
    @ObservedObject var store: JournalStore

    @State private var showDoctorDataNotice = false
    @State private var showVideoCapture = false
    @State private var showVoiceCapture = false

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                List {
                    Section {
                        EmberCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Journal Library")
                                    .font(.headline.weight(.bold))
                                    .foregroundStyle(EmberTheme.textPrimary)
                                Text("Review sessions, monitor trends, and add a new check-in.")
                                    .font(.footnote)
                                    .foregroundStyle(EmberTheme.textSecondary)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)

                    Section("Past Journals") {
                        if store.sessions.isEmpty {
                            Text("No journals yet. Start a voice or video entry.")
                                .foregroundStyle(EmberTheme.textSecondary)
                                .font(.footnote)
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
            .navigationTitle("Journal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            showVideoCapture = true
                        } label: {
                            Label("New Video Journal", systemImage: "video.fill")
                        }
                        Button {
                            showVoiceCapture = true
                        } label: {
                            Label("New Voice Journal", systemImage: "waveform.mic")
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
            .sheet(isPresented: $showVideoCapture) {
                NavigationStack {
                    JournalCaptureView(env: env, store: store, initialKind: .video, lockKindSelection: true)
                }
            }
            .sheet(isPresented: $showVoiceCapture) {
                NavigationStack {
                    JournalCaptureView(env: env, store: store, initialKind: .voice, lockKindSelection: true)
                }
            }
        }
    }

    private func deleteJournals(at offsets: IndexSet) {
        let shouldWarn = store.delete(at: offsets)
        if shouldWarn {
            showDoctorDataNotice = true
        }
    }
}
