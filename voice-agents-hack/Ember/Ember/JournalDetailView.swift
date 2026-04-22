import SwiftUI
import AVKit

struct JournalDetailView: View {
    let session: JournalSession
    let videoURL: URL
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            EmberTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VideoPlayer(player: player ?? AVPlayer(url: videoURL))
                        .frame(height: session.kind == .video ? 260 : 92)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    EmberCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Journal note")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textSecondary)
                            Text(session.noteText.isEmpty ? "No typed context." : session.noteText)
                                .foregroundStyle(EmberTheme.textPrimary)
                            HStack {
                                Text("Journal type")
                                    .font(.caption2)
                                    .foregroundStyle(EmberTheme.textSecondary)
                                Spacer()
                                Text(session.kind == .video ? "Video" : "Voice")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(EmberTheme.textPrimary)
                            }
                            HStack {
                                Text("Shared with clinician")
                                    .font(.caption2)
                                    .foregroundStyle(EmberTheme.textSecondary)
                                Spacer()
                                Text(session.journalSharedWithClinician ? "Yes" : "No")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(EmberTheme.textPrimary)
                            }
                        }
                    }

                    EmberCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Gemma 4 status")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textSecondary)
                            Text((session.gemmaSuccess ?? false) ? "Gemma 4 was able to function successfully." : "Gemma 4 was not able to function for this session.")
                                .foregroundStyle(EmberTheme.textPrimary)
                            Text("Grounding activity: \(session.gemmaAction)")
                                .font(.footnote)
                                .foregroundStyle(EmberTheme.textSecondary)
                            Text(String(format: "Inference latency: %.0f ms", session.gemmaLatencyMs))
                                .font(.caption)
                                .foregroundStyle(EmberTheme.textSecondary)
                        }
                    }

                    EmberCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Biometrics")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(EmberTheme.textSecondary)
                            metricLine("Facial stress", String(format: "%.3f", session.facialStressScore))
                            metricLine("Brow furrow", String(format: "%.3f", session.browFurrowScore))
                            metricLine("Jaw tightness", String(format: "%.3f", session.jawTightnessScore))
                            Divider().overlay(EmberTheme.cardBorder)
                            metricLine("F0", String(format: "%.2f", session.audioMetrics.fundamentalFrequencyHz))
                            metricLine("Jitter/Shimmer", String(format: "%.5f / %.5f", session.audioMetrics.jitterApprox, session.audioMetrics.shimmerApprox))
                            metricLine("RMS", String(format: "%.5f", session.audioMetrics.rms))
                            metricLine("Spectral centroid", String(format: "%.2f", session.audioMetrics.spectralCentroid))
                            metricLine("Spectral rolloff", String(format: "%.2f", session.audioMetrics.spectralRolloff))
                            metricLine("ZCR", String(format: "%.5f", session.audioMetrics.zcrDensity))
                        }
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle(session.createdAt.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if player == nil {
                player = AVPlayer(url: videoURL)
            }
        }
        .onDisappear {
            player?.pause()
            player?.replaceCurrentItem(with: nil)
            player = nil
        }
    }

    private func metricLine(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k)
                .font(.caption2)
                .foregroundStyle(EmberTheme.textSecondary)
            Spacer()
            Text(v)
                .font(.caption.monospacedDigit())
                .foregroundStyle(EmberTheme.textPrimary)
        }
    }
}
