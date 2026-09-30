import AVFoundation
import CoreMedia
import Foundation

struct MediaInspection: Codable {
  let schemaVersion: Int
  let playable: Bool
  let durationMs: Double
  let fileSizeBytes: Int64
  let width: Int?
  let height: Int?
  let nominalFrameRate: Double?
  let videoTrackCount: Int
  let audioTrackCount: Int
  let videoDurationMs: Double?
  let audioDurationMs: Double?
  let videoCodecs: [String]
  let audioCodecs: [String]
  let validationErrors: [String]
}

func milliseconds(_ time: CMTime) -> Double? {
  let seconds = CMTimeGetSeconds(time)
  return seconds.isFinite ? max(0, seconds * 1_000) : nil
}

func codecName(_ description: CMFormatDescription) -> String {
  let subtype = CMFormatDescriptionGetMediaSubType(description)
  let bytes: [UInt8] = [24, 16, 8, 0].map { shift in
    UInt8((subtype >> UInt32(shift)) & 0xff)
  }
  let printable = bytes.map { byte in
    byte >= 32 && byte <= 126 ? Character(UnicodeScalar(byte)) : "?"
  }
  return String(printable)
}

func inspect(url: URL) async -> MediaInspection {
  let asset = AVURLAsset(url: url)
  let fileSize = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?
    .int64Value ?? 0
  var errors: [String] = []

  do {
    let playable = try await asset.load(.isPlayable)
    let duration = try await asset.load(.duration)
    let videoTracks = try await asset.loadTracks(withMediaType: .video)
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    let durationMs = milliseconds(duration) ?? 0

    if !playable { errors.append("Asset is not playable.") }
    if durationMs <= 0 { errors.append("Asset duration is empty or invalid.") }
    if videoTracks.isEmpty { errors.append("Video track is missing.") }

    var width: Int?
    var height: Int?
    var frameRate: Double?
    var videoDurationMs: Double?
    var videoCodecs: [String] = []
    if let video = videoTracks.first {
      let size = try await video.load(.naturalSize)
      let transform = try await video.load(.preferredTransform)
      let transformed = size.applying(transform)
      width = Int(abs(transformed.width).rounded())
      height = Int(abs(transformed.height).rounded())
      frameRate = Double(try await video.load(.nominalFrameRate))
      videoDurationMs = milliseconds(try await video.load(.timeRange).duration)
      videoCodecs = try await video.load(.formatDescriptions).map(codecName)
    }

    var audioDurationMs: Double?
    var audioCodecs: [String] = []
    if let audio = audioTracks.first {
      audioDurationMs = milliseconds(try await audio.load(.timeRange).duration)
      audioCodecs = try await audio.load(.formatDescriptions).map(codecName)
    }

    if let videoDurationMs, let audioDurationMs, abs(videoDurationMs - audioDurationMs) > 250 {
      errors.append("Audio/video duration differs by more than 250 ms.")
    }

    return MediaInspection(
      schemaVersion: 1,
      playable: playable,
      durationMs: durationMs,
      fileSizeBytes: fileSize,
      width: width,
      height: height,
      nominalFrameRate: frameRate,
      videoTrackCount: videoTracks.count,
      audioTrackCount: audioTracks.count,
      videoDurationMs: videoDurationMs,
      audioDurationMs: audioDurationMs,
      videoCodecs: videoCodecs,
      audioCodecs: audioCodecs,
      validationErrors: errors
    )
  } catch {
    return MediaInspection(
      schemaVersion: 1,
      playable: false,
      durationMs: 0,
      fileSizeBytes: fileSize,
      width: nil,
      height: nil,
      nominalFrameRate: nil,
      videoTrackCount: 0,
      audioTrackCount: 0,
      videoDurationMs: nil,
      audioDurationMs: nil,
      videoCodecs: [],
      audioCodecs: [],
      validationErrors: ["Asset could not be inspected: \(error.localizedDescription)"]
    )
  }
}

@main
struct MediaInspectorCommand {
  static func main() async {
    guard CommandLine.arguments.count == 2 else {
      fputs("Usage: MediaInspector <recording-path>\n", stderr)
      exit(64)
    }

    let result = await inspect(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    do {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      print(String(decoding: try encoder.encode(result), as: UTF8.self))
      if !result.validationErrors.isEmpty { exit(1) }
    } catch {
      fputs("Unable to encode inspection result: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
