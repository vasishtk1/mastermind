import AVFoundation
import Foundation

/// Captures microphone audio as 16 kHz mono Int16 PCM chunks for realtime Cactus processing.
final class RealtimeAudioStreamService: NSObject {
    private let engine = AVAudioEngine()
    private var continuation: AsyncThrowingStream<Data, Error>.Continuation?
    private(set) var isRunning = false

    func requestPermission() async -> Bool {
        if #available(iOS 17.0, *) {
            return await AVAudioApplication.requestRecordPermission()
        }
        return await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func startStreaming(chunkSeconds: Double = 1.0) throws -> AsyncThrowingStream<Data, Error> {
        stopStreaming()

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setPreferredSampleRate(48_000)
        try session.setActive(true, options: [])

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let frameCount = max(256, Int(format.sampleRate * max(0.2, chunkSeconds)))
        let bufferSize = AVAudioFrameCount(frameCount)

        let stream = AsyncThrowingStream<Data, Error> { continuation in
            self.continuation = continuation
            continuation.onTermination = { [weak self] _ in
                self?.stopStreaming()
            }
        }

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            do {
                let pcm = try Self.toPCM16kMonoInt16(buffer: buffer)
                guard !pcm.isEmpty else { return }
                self.continuation?.yield(pcm)
            } catch {
                self.continuation?.finish(throwing: error)
                self.stopStreaming()
            }
        }

        engine.prepare()
        try engine.start()
        isRunning = true
        return stream
    }

    func stopStreaming() {
        if isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            isRunning = false
        }
        continuation?.finish()
        continuation = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private static func toPCM16kMonoInt16(buffer: AVAudioPCMBuffer) throws -> Data {
        let srcRate = buffer.format.sampleRate
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return Data() }

        if buffer.format.commonFormat == .pcmFormatInt16, buffer.format.channelCount == 1, let ch = buffer.int16ChannelData {
            let src = ch[0]
            if abs(srcRate - AudioCaptureService.cactusPCMSampleRate) < 1.0 {
                return Data(bytes: UnsafeRawPointer(src), count: frameLength * MemoryLayout<Int16>.size)
            }
            return resampleInt16(
                src: src,
                count: frameLength,
                srcRate: srcRate,
                dstRate: AudioCaptureService.cactusPCMSampleRate
            )
        }

        if let floatData = buffer.floatChannelData {
            let channelCount = Int(buffer.format.channelCount)
            let mono = mixToMono(floatData: floatData, channelCount: channelCount, frames: frameLength)
            return resampleFloatToInt16(
                src: mono,
                srcRate: srcRate,
                dstRate: AudioCaptureService.cactusPCMSampleRate
            )
        }

        throw NSError(domain: "Ember", code: 91, userInfo: [NSLocalizedDescriptionKey: "Unsupported realtime audio format"])
    }

    private static func mixToMono(
        floatData: UnsafePointer<UnsafeMutablePointer<Float>>,
        channelCount: Int,
        frames: Int
    ) -> [Float] {
        if channelCount <= 1 {
            return Array(UnsafeBufferPointer(start: floatData[0], count: frames))
        }
        var out = [Float](repeating: 0, count: frames)
        let inv = 1.0 / Float(channelCount)
        for frame in 0..<frames {
            var sum: Float = 0
            for c in 0..<channelCount {
                sum += floatData[c][frame]
            }
            out[frame] = sum * inv
        }
        return out
    }

    private static func resampleInt16(src: UnsafePointer<Int16>, count: Int, srcRate: Double, dstRate: Double) -> Data {
        let ratio = dstRate / srcRate
        if abs(ratio * 3.0 - 1.0) < 0.01, count >= 3 {
            let outCount = count / 3
            var out = [Int16](repeating: 0, count: outCount)
            for i in 0..<outCount {
                out[i] = src[i * 3]
            }
            return out.withUnsafeBytes { Data($0) }
        }

        let outCount = max(1, Int((Double(count) * dstRate / srcRate).rounded(.down)))
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcPos = Double(i) * srcRate / dstRate
            let j = Int(srcPos)
            let f = srcPos - Double(j)
            let a = Int32(src[min(j, count - 1)])
            let b = Int32(src[min(j + 1, count - 1)])
            let s = (1.0 - f) * Double(a) + f * Double(b)
            out[i] = Int16(max(Double(Int16.min), min(Double(Int16.max), s)))
        }
        return out.withUnsafeBytes { Data($0) }
    }

    private static func resampleFloatToInt16(src: [Float], srcRate: Double, dstRate: Double) -> Data {
        let count = src.count
        let ratio = dstRate / srcRate
        if abs(ratio * 3.0 - 1.0) < 0.01, count >= 3 {
            let outCount = count / 3
            var out = [Int16](repeating: 0, count: outCount)
            for i in 0..<outCount {
                out[i] = Int16(max(-1, min(1, src[i * 3])) * 32_767.0)
            }
            return out.withUnsafeBytes { Data($0) }
        }

        let outCount = max(1, Int((Double(count) * dstRate / srcRate).rounded(.down)))
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcPos = Double(i) * srcRate / dstRate
            let j = Int(srcPos)
            let f = srcPos - Double(j)
            let a = src[min(j, count - 1)]
            let b = src[min(j + 1, count - 1)]
            let s = (1.0 - Float(f)) * a + Float(f) * b
            out[i] = Int16(max(-1, min(1, s)) * 32_767.0)
        }
        return out.withUnsafeBytes { Data($0) }
    }
}
