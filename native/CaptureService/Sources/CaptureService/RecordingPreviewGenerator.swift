import Foundation

#if canImport(AVFoundation) && canImport(CoreMedia)
import AVFoundation
import CoreMedia

/// Produces a disposable H.264 proxy that Chromium can decode while edits retain the source file.
actor RecordingPreviewGenerator {
  func prepare(_ payload: RecordingPreviewPayload) async throws -> NativeRecordingPreviewResult {
    let inputURL = URL(fileURLWithPath: payload.inputPath).standardizedFileURL
    let outputURL = URL(fileURLWithPath: payload.outputPath).standardizedFileURL
    guard !payload.inputPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !payload.outputPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          inputURL != outputURL else {
      throw NativeServiceError.invalidConfiguration("Preview input and output paths are invalid.")
    }

    let asset = AVURLAsset(url: inputURL)
    guard try await !asset.loadTracks(withMediaType: .video).isEmpty else {
      throw NativeServiceError.invalidConfiguration("The preview source has no video track.")
    }
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    guard !FileManager.default.fileExists(atPath: outputURL.path) else {
      throw NativeServiceError.fileFinalizationFailed("The preview output already exists.")
    }

    do {
      let preset = try await compatiblePreset(for: asset)
      guard let exporter = AVAssetExportSession(asset: asset, presetName: preset) else {
        throw NativeServiceError.encodingUnavailable(
          "A compatible H.264 preview encoder is unavailable on this Mac."
        )
      }
      exporter.videoComposition = try await makeFrameRateComposition(for: asset)
      exporter.shouldOptimizeForNetworkUse = true
      try await exporter.export(to: outputURL, as: .mp4)
      try await requireH264Output(at: outputURL)
      return NativeRecordingPreviewResult(status: "completed", filePath: outputURL.path)
    } catch {
      try? FileManager.default.removeItem(at: outputURL)
      if let serviceError = error as? NativeServiceError { throw serviceError }
      throw NativeServiceError.fileFinalizationFailed(
        "The editing preview could not be prepared: \(error.localizedDescription)"
      )
    }
  }

  private func makeFrameRateComposition(for asset: AVURLAsset) async throws
    -> AVMutableVideoComposition
  {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw NativeServiceError.invalidConfiguration("The preview source has no video track.")
    }
    let naturalSize = try await track.load(.naturalSize)
    let preferredTransform = try await track.load(.preferredTransform)
    let orientedBounds = CGRect(origin: .zero, size: naturalSize)
      .applying(preferredTransform)
      .standardized
    let duration = try await asset.load(.duration)
    guard orientedBounds.width >= 2, orientedBounds.height >= 2 else {
      throw NativeServiceError.invalidConfiguration("The preview dimensions are invalid.")
    }

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(
      preferredTransform.concatenating(
        CGAffineTransform(translationX: -orientedBounds.minX, y: -orientedBounds.minY)
      ),
      at: .zero
    )
    instruction.layerInstructions = [layer]

    let composition = AVMutableVideoComposition()
    composition.instructions = [instruction]
    composition.renderSize = CGSize(
      width: floor(orientedBounds.width / 2) * 2,
      height: floor(orientedBounds.height / 2) * 2
    )
    composition.frameDuration = CMTime(value: 1, timescale: 60)
    return composition
  }

  private func compatiblePreset(for asset: AVURLAsset) async throws -> String {
    // A 1280-pixel proxy is sharp enough for editing and keeps 4K/ProRes sources responsive.
    for preset in [AVAssetExportPreset1280x720, AVAssetExportPresetMediumQuality] {
      if await AVAssetExportSession.compatibility(
        ofExportPreset: preset,
        with: asset,
        outputFileType: .mp4
      ) {
        return preset
      }
    }
    throw NativeServiceError.encodingUnavailable(
      "No compatible editing preview preset is available for this recording."
    )
  }

  private func requireH264Output(at outputURL: URL) async throws {
    let outputAsset = AVURLAsset(url: outputURL)
    guard let track = try await outputAsset.loadTracks(withMediaType: .video).first,
          let description = try await track.load(.formatDescriptions).first,
          CMFormatDescriptionGetMediaSubType(description) == kCMVideoCodecType_H264 else {
      throw NativeServiceError.encodingUnavailable(
        "The editing preview encoder did not produce H.264 video."
      )
    }
  }
}
#endif
