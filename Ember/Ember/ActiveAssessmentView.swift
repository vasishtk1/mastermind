import ARKit
import SceneKit
import SwiftUI

struct ActiveAssessmentView: View {
    @ObservedObject var env: AppEnvironment
    @Environment(\.dismiss) private var dismiss

    @StateObject private var scanner = ActiveAssessmentFaceScanner()
    @State private var userText = ""
    @State private var isSubmitting = false
    @State private var resultText = ""
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            ZStack {
                EmberTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Check-in assessment")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(EmberTheme.textPrimary)

                        Text("Briefly describe what you're feeling while Ember captures a 5-second facial stress scan.")
                            .font(.footnote)
                            .foregroundStyle(EmberTheme.textSecondary)

                        AssessmentFacePreview(session: scanner.session)
                            .frame(height: 170)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(EmberTheme.cardBorder, lineWidth: 1)
                            )
                            .opacity(0.95)

                        Text("Facial stress score: \(scanner.facialStressScore, specifier: "%.3f")")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(EmberTheme.textSecondary)
                        ProgressView(value: scanner.scanProgress)
                            .tint(EmberTheme.accent)

                        TextField("Briefly describe what you're feeling...", text: $userText, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.black.opacity(0.35))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .stroke(EmberTheme.cardBorder, lineWidth: 1)
                                    )
                            )
                            .foregroundStyle(EmberTheme.textPrimary)

                        Button {
                            Task { await submitAssessment() }
                        } label: {
                            Text(isSubmitting ? "Analyzing..." : "Submit & Analyze")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(EmberPrimaryButtonStyle(enabled: !isSubmitting && !userText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                        .disabled(isSubmitting || userText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if !resultText.isEmpty {
                            EmberCard {
                                Text(resultText)
                                    .font(.body)
                                    .foregroundStyle(EmberTheme.textPrimary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        if let errorText {
                            Text(errorText)
                                .font(.footnote)
                                .foregroundStyle(EmberTheme.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Active Assessment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .tint(EmberTheme.textPrimary)
                }
            }
        }
        .task {
            scanner.start()
        }
        .onDisappear {
            scanner.stop()
        }
    }

    @MainActor
    private func submitAssessment() async {
        isSubmitting = true
        defer { isSubmitting = false }
        errorText = nil
        resultText = ""

        do {
            let facialScore = scanner.facialStressScore
            let inference = try await CactusManager.shared.runInterventionAgent(
                textInput: userText,
                facialStressScore: facialScore,
                patientId: env.patientId
            )
            let facialBundle = scanner.aggregatedBlendShapeScores
            try await env.api.uploadIncident(
                patientId: env.patientId,
                text: userText,
                facialData: facialBundle,
                gemmaAction: inference.groundingAction,
                gemmaSuccess: true,
                gemmaLatencyMs: inference.totalTimeMs,
                gemmaRawResponseJSON: inference.rawResponseJSON
            )
            resultText = "Suggested grounding activity: \(inference.groundingAction)\n\n\(inference.modelResponse)"
        } catch {
            errorText = "Assessment failed: \(error.localizedDescription)"
        }
    }
}

private final class ActiveAssessmentFaceScanner: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()

    @Published var scanProgress: Double = 0
    @Published var facialStressScore: Double = 0
    @Published var aggregatedBlendShapeScores: [String: Double] = [:]

    private let queue = DispatchQueue(label: "com.ember.assessment.face", qos: .userInitiated)
    private var startDate: Date?
    private var sampleCount: Double = 0
    private var accum: [String: Double] = [:]
    private var timer: DispatchSourceTimer?
    private let captureSec: TimeInterval = 5.0

    func start() {
        guard ARFaceTrackingConfiguration.isSupported else { return }
        startDate = Date()
        sampleCount = 0
        accum.removeAll()
        scanProgress = 0
        facialStressScore = 0
        aggregatedBlendShapeScores.removeAll()

        session.delegate = self
        session.delegateQueue = queue
        let config = ARFaceTrackingConfiguration()
        config.isLightEstimationEnabled = true
        session.run(config, options: [.resetTracking, .removeExistingAnchors])

        timer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(100))
        t.setEventHandler { [weak self] in
            guard let self, let startDate = self.startDate else { return }
            let elapsed = Date().timeIntervalSince(startDate)
            let progress = max(0, min(1, elapsed / self.captureSec))
            Task { @MainActor in
                self.scanProgress = progress
            }
            if elapsed >= self.captureSec {
                self.computeFinalScore()
                t.cancel()
            }
        }
        timer = t
        t.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
        session.pause()
        session.delegate = nil
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        let keys: [ARFaceAnchor.BlendShapeLocation] = [.jawForward, .mouthPressLeft, .mouthPressRight, .browDownLeft, .browDownRight, .browInnerUp]
        for key in keys {
            let name = key.rawValue
            let value = face.blendShapes[key]?.doubleValue ?? 0
            accum[name, default: 0] += value
        }
        sampleCount += 1
    }

    private func computeFinalScore() {
        guard sampleCount > 0 else { return }
        var means: [String: Double] = [:]
        for (k, v) in accum {
            means[k] = v / sampleCount
        }
        let jaw = ((means[ARFaceAnchor.BlendShapeLocation.jawForward.rawValue] ?? 0)
            + (means[ARFaceAnchor.BlendShapeLocation.mouthPressLeft.rawValue] ?? 0)
            + (means[ARFaceAnchor.BlendShapeLocation.mouthPressRight.rawValue] ?? 0)) / 3.0
        let brow = ((means[ARFaceAnchor.BlendShapeLocation.browDownLeft.rawValue] ?? 0)
            + (means[ARFaceAnchor.BlendShapeLocation.browDownRight.rawValue] ?? 0)
            + (means[ARFaceAnchor.BlendShapeLocation.browInnerUp.rawValue] ?? 0) * 0.6) / 2.6
        let score = max(0, min(1, jaw * 0.55 + brow * 0.45))

        Task { @MainActor in
            self.aggregatedBlendShapeScores = means
            self.facialStressScore = score
            self.scanProgress = 1
        }
    }
}

private struct AssessmentFacePreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = true
        view.session = session
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        if uiView.session !== session {
            uiView.session = session
        }
    }
}
