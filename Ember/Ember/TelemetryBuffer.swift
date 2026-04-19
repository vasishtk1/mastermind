import Foundation

actor TelemetryBuffer {
    private let endpointURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let flushIntervalNs: UInt64

    private var faces: [ARFaceTelemetrySample] = []
    private var motions: [MotionTelemetrySample] = []
    private var vocals: [VocalProsodyTelemetrySample] = []
    private var touches: [TouchTelemetrySample] = []
    private var environments: [SensoryEnvironmentTelemetrySample] = []

    private var flushTask: Task<Void, Never>?
    private var onUploadResult: (@Sendable (Bool, String) -> Void)?

    init(
        endpointURL: URL,
        flushIntervalMs: UInt64 = 500,
        onUploadResult: (@Sendable (Bool, String) -> Void)? = nil
    ) {
        self.endpointURL = endpointURL
        self.flushIntervalNs = flushIntervalMs * 1_000_000
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 20
        self.session = URLSession(configuration: config)
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.sortedKeys]
        self.encoder.keyEncodingStrategy = .convertToSnakeCase
        self.onUploadResult = onUploadResult
    }

    func start() {
        guard flushTask == nil else { return }
        let interval = flushIntervalNs
        flushTask = Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: interval)
                await self.flushIfNeeded()
            }
        }
    }

    func stop() async {
        flushTask?.cancel()
        flushTask = nil
        await flushIfNeeded()
    }

    func append(face sample: ARFaceTelemetrySample) {
        faces.append(sample)
    }

    func append(motion sample: MotionTelemetrySample) {
        motions.append(sample)
    }

    func append(vocal sample: VocalProsodyTelemetrySample) {
        vocals.append(sample)
    }

    func append(touch sample: TouchTelemetrySample) {
        touches.append(sample)
    }

    func append(environment sample: SensoryEnvironmentTelemetrySample) {
        environments.append(sample)
    }

    private func flushIfNeeded() async {
        guard !faces.isEmpty || !motions.isEmpty || !vocals.isEmpty || !touches.isEmpty || !environments.isEmpty else {
            return
        }

        let payload = TelemetryBatchPayload(
            emittedAtISO8601: ISO8601DateFormatter().string(from: Date()),
            faces: faces,
            motions: motions,
            vocals: vocals,
            touches: touches,
            environments: environments
        )

        // Clear immediately so producers remain non-blocking.
        faces.removeAll(keepingCapacity: true)
        motions.removeAll(keepingCapacity: true)
        vocals.removeAll(keepingCapacity: true)
        touches.removeAll(keepingCapacity: true)
        environments.removeAll(keepingCapacity: true)

        do {
            var request = URLRequest(url: endpointURL)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(payload)
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                onUploadResult?(false, "Telemetry upload failed (non-2xx)")
                return
            }
            onUploadResult?(true, "Telemetry batch uploaded")
        } catch {
            onUploadResult?(false, "Telemetry upload failed: \(error.localizedDescription)")
        }
    }
}
