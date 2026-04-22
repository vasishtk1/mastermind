import SwiftUI
import UIKit

struct TouchTelemetryCaptureView: UIViewRepresentable {
    let onSample: @Sendable (TouchTelemetrySample) -> Void

    func makeUIView(context: Context) -> TouchCaptureAttachmentView {
        let view = TouchCaptureAttachmentView()
        view.installIfNeeded(onSample: onSample)
        return view
    }

    func updateUIView(_ uiView: TouchCaptureAttachmentView, context: Context) {
        uiView.installIfNeeded(onSample: onSample)
    }
}

final class TouchCaptureAttachmentView: UIView {
    private var recognizer: TouchTelemetryGestureRecognizer?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func installIfNeeded(onSample: @escaping @Sendable (TouchTelemetrySample) -> Void) {
        guard recognizer == nil else {
            recognizer?.onSample = onSample
            return
        }
        let g = TouchTelemetryGestureRecognizer()
        g.cancelsTouchesInView = false
        g.delaysTouchesBegan = false
        g.delaysTouchesEnded = false
        g.onSample = onSample
        recognizer = g

        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.window ?? self.superview else { return }
            host.addGestureRecognizer(g)
        }
    }
}

final class TouchTelemetryGestureRecognizer: UIGestureRecognizer {
    var onSample: (@Sendable (TouchTelemetrySample) -> Void)?

    private var lastTapTimestamp: TimeInterval?
    private var previousPointByTouch: [ObjectIdentifier: CGPoint] = [:]
    private var previousTimeByTouch: [ObjectIdentifier: TimeInterval] = [:]

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        emit(touches: touches, phase: "began")
        state = .possible
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        emit(touches: touches, phase: "moved")
        state = .possible
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        emit(touches: touches, phase: "ended")
        clearTracking(for: touches)
        state = .possible
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        emit(touches: touches, phase: "cancelled")
        clearTracking(for: touches)
        state = .cancelled
    }

    override func reset() {
        state = .possible
    }

    private func emit(touches: Set<UITouch>, phase: String) {
        guard let view = self.view else { return }
        for touch in touches {
            let id = ObjectIdentifier(touch)
            let loc = touch.location(in: view)
            let timestamp = touch.timestamp
            let interTap: Double? = {
                guard phase == "began", touch.tapCount > 0 else { return nil }
                defer { lastTapTimestamp = timestamp }
                guard let lastTapTimestamp else { return nil }
                return timestamp - lastTapTimestamp
            }()

            let velocity: Double? = {
                guard let prev = previousPointByTouch[id], let prevT = previousTimeByTouch[id], timestamp > prevT else {
                    return nil
                }
                let dx = loc.x - prev.x
                let dy = loc.y - prev.y
                let dist = hypot(dx, dy)
                return Double(dist / CGFloat(timestamp - prevT))
            }()

            previousPointByTouch[id] = loc
            previousTimeByTouch[id] = timestamp

            let sample = TouchTelemetrySample(
                timestampUptimeSec: timestamp,
                phase: phase,
                x: loc.x,
                y: loc.y,
                majorRadius: touch.majorRadius,
                majorRadiusTolerance: touch.majorRadiusTolerance,
                force: touch.force,
                tapCount: touch.tapCount,
                interTapIntervalSec: interTap,
                swipeVelocityPointsPerSec: velocity
            )
            onSample?(sample)
        }
    }

    private func clearTracking(for touches: Set<UITouch>) {
        for touch in touches {
            let id = ObjectIdentifier(touch)
            previousPointByTouch.removeValue(forKey: id)
            previousTimeByTouch.removeValue(forKey: id)
        }
    }
}
