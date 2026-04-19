import AVFoundation
import Foundation

/// Records microphone to a temporary linear-PCM file, then converts to 16 kHz mono Int16 PCM for Cactus.
/// Resampling avoids `AVAudioConverter` single-shot edge cases that surface as **OSStatus -50** (`paramErr`) on device.
final class AudioCaptureService: NSObject {
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    /// Output sample rate expected by Cactus multimodal audio paths.
    static let cactusPCMSampleRate: Double = 16_000

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

    func prepareSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setPreferredSampleRate(48_000)
        try session.setActive(true, options: [])
    }

    func startRecording() throws {
        try prepareSession()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ember_capture_\(UUID().uuidString).caf")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]

        let r = try AVAudioRecorder(url: url, settings: settings)
        r.isMeteringEnabled = true
        r.prepareToRecord()
        guard r.record() else {
            throw NSError(domain: "Ember", code: 50, userInfo: [NSLocalizedDescriptionKey: "Could not start recorder"])
        }
        recorder = r
    }

    func stopRecorderReturningFileURL() throws -> URL {
        guard recorder != nil else {
            throw NSError(domain: "Ember", code: 51, userInfo: [NSLocalizedDescriptionKey: "Recorder was not running"])
        }
        recorder?.stop()
        recorder = nil
        guard let url = recordingURL else {
            throw NSError(domain: "Ember", code: 52, userInfo: [NSLocalizedDescriptionKey: "No recording URL"])
        }
        recordingURL = nil
        return url
    }

    func stopRecording() throws -> Data {
        let url = try stopRecorderReturningFileURL()
        defer { try? FileManager.default.removeItem(at: url) }
        return try Self.convertFileToPCM16kMonoInt16(url: url)
    }

    /// Produces little-endian Int16 mono PCM at 16 kHz without relying on `AVAudioConverter` (avoids -50 on hardware).
    static func convertFileToPCM16kMonoInt16(url: URL) throws -> Data {
        let audioFile = try AVAudioFile(forReading: url)
        let fmt = audioFile.processingFormat
        let frameCount = Int(audioFile.length)
        guard frameCount > 0 else {
            throw NSError(domain: "Ember", code: 56, userInfo: [NSLocalizedDescriptionKey: "Recording was empty — speak longer or check the microphone."])
        }

        guard let pcm = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(frameCount)) else {
            throw NSError(domain: "Ember", code: 53, userInfo: [NSLocalizedDescriptionKey: "Source buffer alloc failed"])
        }
        try audioFile.read(into: pcm)
        guard pcm.frameLength > 0 else {
            throw NSError(domain: "Ember", code: 56, userInfo: [NSLocalizedDescriptionKey: "Recording was empty — speak longer or check the microphone."])
        }

        let srcRate = fmt.sampleRate
        let nIn = Int(pcm.frameLength)
        let target = cactusPCMSampleRate

        if fmt.commonFormat == .pcmFormatInt16, fmt.channelCount == 1, let ch = pcm.int16ChannelData {
            let src = ch[0]
            if abs(srcRate - target) < 1.0 {
                return Data(bytes: UnsafeRawPointer(src), count: nIn * MemoryLayout<Int16>.size)
            }
            return resampleInt16Mono(src: src, count: nIn, srcRate: srcRate, dstRate: target)
        }

        if fmt.commonFormat == .pcmFormatFloat32, fmt.channelCount == 1, let ch = pcm.floatChannelData {
            let src = ch[0]
            return resampleFloatMonoToInt16(src: src, count: nIn, srcRate: srcRate, dstRate: target)
        }

        throw NSError(
            domain: "Ember",
            code: 57,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported capture format \(fmt.commonFormat.rawValue); need mono Int16 or Float32."]
        )
    }

    private static func resampleInt16Mono(src: UnsafePointer<Int16>, count: Int, srcRate: Double, dstRate: Double) -> Data {
        let ratio = dstRate / srcRate
        if abs(ratio * 3.0 - 1.0) < 0.01 {
            // 48 kHz → 16 kHz (exactly 1:3)
            let outCount = count / 3
            if outCount > 0 {
                var out = [Int16](repeating: 0, count: outCount)
                for i in 0..<outCount {
                    out[i] = src[i * 3]
                }
                return out.withUnsafeBytes { Data($0) }
            }
            // Fewer than 3 frames — fall through to linear (avoids empty output).
        }
        return linearResampleInt16(src: src, count: count, srcRate: srcRate, dstRate: dstRate)
    }

    private static func linearResampleInt16(src: UnsafePointer<Int16>, count: Int, srcRate: Double, dstRate: Double) -> Data {
        let outCount = max(1, Int((Double(count) * dstRate / srcRate).rounded(.down)))
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcPos = Double(i) * srcRate / dstRate
            let j = Int(srcPos)
            let f = srcPos - Double(j)
            let a = Int32(src[min(j, count - 1)])
            let b = Int32(src[min(j + 1, count - 1)])
            let s = (1.0 - f) * Double(a) + f * Double(b)
            let clamped = max(Double(Int16.min), min(Double(Int16.max), s))
            out[i] = Int16(clamped)
        }
        return out.withUnsafeBytes { Data($0) }
    }

    private static func resampleFloatMonoToInt16(src: UnsafePointer<Float>, count: Int, srcRate: Double, dstRate: Double) -> Data {
        let ratio = dstRate / srcRate
        if abs(ratio * 3.0 - 1.0) < 0.01 {
            let outCount = count / 3
            if outCount > 0 {
                var out = [Int16](repeating: 0, count: outCount)
                for i in 0..<outCount {
                    let s = max(-1, min(1, src[i * 3]))
                    out[i] = Int16(s * 32_767.0)
                }
                return out.withUnsafeBytes { Data($0) }
            }
        }
        let outCount = max(1, Int((Double(count) * dstRate / srcRate).rounded(.down)))
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcPos = Double(i) * srcRate / dstRate
            let j = Int(srcPos)
            let f = srcPos - Double(j)
            let a = j < count ? src[j] : 0
            let b = j + 1 < count ? src[j + 1] : a
            let s = (1.0 - Float(f)) * a + Float(f) * b
            let c = max(-1, min(1, s))
            out[i] = Int16(Double(c) * 32_767.0)
        }
        return out.withUnsafeBytes { Data($0) }
    }
}
