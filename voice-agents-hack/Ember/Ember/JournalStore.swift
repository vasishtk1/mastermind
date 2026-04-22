import Foundation

@MainActor
final class JournalStore: ObservableObject {
    @Published private(set) var sessions: [JournalSession] = []

    private let fileURL: URL

    init() {
        let root = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        let dir = root.appendingPathComponent("EmberJournal", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("sessions.json")
        load()
    }

    func add(_ session: JournalSession) {
        sessions.insert(session, at: 0)
        save()
    }

    func markJournalShared(_ sessionID: UUID) {
        guard let idx = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        sessions[idx].journalSharedWithClinician = true
        save()
    }

    @discardableResult
    func delete(at offsets: IndexSet) -> Bool {
        var warned = false
        let sorted = offsets.sorted(by: >)
        for idx in sorted {
            guard sessions.indices.contains(idx) else { continue }
            let session = sessions[idx]
            let url = videoURL(for: session)
            if FileManager.default.fileExists(atPath: url.path) {
                try? FileManager.default.removeItem(at: url)
            }
            warned = warned || session.biometricsSent || session.journalSharedWithClinician
            sessions.remove(at: idx)
        }
        save()
        return warned
    }

    func videoURL(for session: JournalSession) -> URL {
        fileURL.deletingLastPathComponent().appendingPathComponent(session.videoFileName)
    }

    func videoURL(forFileName fileName: String) -> URL {
        fileURL.deletingLastPathComponent().appendingPathComponent(fileName)
    }

    func persistVideoFromTemp(_ tempURL: URL) throws -> String {
        let ext = tempURL.pathExtension.isEmpty ? "mov" : tempURL.pathExtension
        let fileName = "journal_\(UUID().uuidString).\(ext)"
        let dest = fileURL.deletingLastPathComponent().appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.copyItem(at: tempURL, to: dest)
        return fileName
    }

    func persistVoiceFromTemp(_ tempURL: URL) throws -> String {
        let ext = tempURL.pathExtension.isEmpty ? "caf" : tempURL.pathExtension
        let fileName = "voice_journal_\(UUID().uuidString).\(ext)"
        let dest = fileURL.deletingLastPathComponent().appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.copyItem(at: tempURL, to: dest)
        return fileName
    }

    private func save() {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        if let data = try? enc.encode(sessions) {
            try? data.write(to: fileURL, options: [.atomic])
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        if let decoded = try? dec.decode([JournalSession].self, from: data) {
            sessions = decoded
        }
    }
}
